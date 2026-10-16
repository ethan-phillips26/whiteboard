import { useMemo, useRef, useState } from "react";
import { grade, recordAttempt } from "../browser/claude.js";
import { answered, check, correctText, tally } from "../lib/quiz.js";
import { Line } from "./Markdown.jsx";

const KIND = {
  multiple_choice: "Choose one", multi_select: "Choose all that apply",
  true_false: "True or false", numeric: "Number", fill_blank: "Fill in the blank",
  short_answer: "Short answer",
};

const percent = (x) => `${Math.round(x * 100)}%`;

/** Whether a finished question counts as missed — wrong, or graded below full credit. */
const missed = (q, r) => q.type === "short_answer" ? (r?.grade?.score ?? 0) < 0.85 : !r?.correct;

function Answer({ q, value, onChange, locked, result }) {
  const mark = (i) => {
    if (!locked) return "";
    const right = q.type === "multi_select" ? q.answer.includes(i) : q.answer === i;
    const picked = q.type === "multi_select" ? (value ?? []).includes(i) : value === i;
    return right ? " right" : picked ? " wrong" : "";
  };
  const name = q.id;
  switch (q.type) {
    case "multiple_choice":
      return (
        <div className="qz-choices" role="radiogroup" aria-label={q.prompt}>
          {q.choices.map((c, i) => (
            <label key={i} className={"qz-choice" + mark(i)}>
              <input type="radio" name={name} checked={value === i} disabled={locked}
                     onChange={() => onChange(i)} />
              <span><Line text={c} /></span>
            </label>
          ))}
        </div>
      );
    case "multi_select":
      return (
        <div className="qz-choices">
          {q.choices.map((c, i) => (
            <label key={i} className={"qz-choice" + mark(i)}>
              <input type="checkbox" checked={(value ?? []).includes(i)} disabled={locked}
                     onChange={(e) => onChange(e.target.checked
                       ? [...(value ?? []), i] : (value ?? []).filter((x) => x !== i))} />
              <span><Line text={c} /></span>
            </label>
          ))}
        </div>
      );
    case "true_false":
      return (
        <div className="qz-choices qz-tf" role="radiogroup" aria-label={q.prompt}>
          {[true, false].map((v) => (
            <label key={String(v)}
                   className={"qz-choice" + (locked ? (q.answer === v ? " right" : value === v ? " wrong" : "") : "")}>
              <input type="radio" name={name} checked={value === v} disabled={locked}
                     onChange={() => onChange(v)} />
              <span>{v ? "True" : "False"}</span>
            </label>
          ))}
        </div>
      );
    case "numeric":
      return (
        <div className="qz-line">
          <input inputMode="decimal" value={value ?? ""} disabled={locked} placeholder="Your answer"
                 aria-label="Your answer" onChange={(e) => onChange(e.target.value)} />
          {q.unit && <span className="note dim">{q.unit}</span>}
        </div>
      );
    case "fill_blank":
      return (
        <input value={value ?? ""} disabled={locked} placeholder="Fill in the blank"
               aria-label="Fill in the blank" onChange={(e) => onChange(e.target.value)} />
      );
    default:
      return (
        <textarea rows={4} value={value ?? ""} disabled={locked} placeholder="Write your answer"
                  aria-label="Your answer" onChange={(e) => onChange(e.target.value)} />
      );
  }
}

function Feedback({ q, result }) {
  if (!result) return null;
  if (q.type === "short_answer") {
    if (result.pending) return <p className="note qz-fb"><span className="spin" /> Claude is grading this…</p>;
    if (result.error) return <p className="err qz-fb">{result.error}</p>;
    const g = result.grade;
    return (
      <div className="qz-fb">
        <p>
          <span className={"flag " + (g.verdict === "correct" ? "ok" : g.verdict === "partial" ? "warn" : "bad")}>
            {g.verdict === "correct" ? "Correct" : g.verdict === "partial" ? "Partly right" : "Not quite"} · {percent(g.score)}
          </span>
        </p>
        {g.feedback && <p>{g.feedback}</p>}
        {g.verdict !== "correct" && <p className="note"><strong>A model answer:</strong> {q.reference}</p>}
        {q.explanation && <p className="note">{q.explanation}</p>}
      </div>
    );
  }
  return (
    <div className="qz-fb">
      <p><span className={"flag " + (result.correct ? "ok" : "bad")}>{result.correct ? "Correct" : "Incorrect"}</span></p>
      {!result.correct && <p className="note"><strong>Answer:</strong> {correctText(q)}</p>}
      {q.explanation && <p className="note">{q.explanation}</p>}
    </div>
  );
}

function Question({ q, n, total, value, onChange, result, onCheck }) {
  const locked = !!result && !result.error;
  const parts = q.type === "fill_blank" ? q.prompt.split("___") : null;
  return (
    <section className="panel qz-q">
      <div className="panel-head">
        <h2>Question {n} of {total}</h2>
        <span className="note dim">{KIND[q.type]}</span>
      </div>
      <p className="qz-prompt">
        {parts
          ? parts.map((p, i) => <span key={i}><Line text={p} />{i < parts.length - 1 && <span className="qz-blank">____</span>}</span>)
          : <Line text={q.prompt} />}
      </p>
      <Answer q={q} value={value} onChange={onChange} locked={locked} result={result} />
      {!locked && (
        <div className="set-actions">
          <button className="primary" onClick={onCheck}
                  disabled={!answered(q, value) || result?.pending}>
            {q.type === "short_answer" ? "Submit for grading" : "Check answer"}
          </button>
        </div>
      )}
      <Feedback q={q} result={result} />
    </section>
  );
}

/** A quiz being taken. Questions with one right answer are marked the moment they
 * are checked; a short answer is sent to Claude and marked when it comes back. */
export default function Quiz({ item }) {
  // Which questions this run covers: all of them, or only those missed last time.
  const [run, setRun] = useState({ n: 1, only: null });
  const questions = useMemo(
    () => item.questions.filter((q) => !run.only || run.only.includes(q.id)),
    [item, run]);
  const [values, setValues] = useState({});
  const [results, setResults] = useState({});
  const recorded = useRef(0);

  const quiz = { questions };
  const t = tally(quiz, results);
  const finished = questions.every((q) => results[q.id] && !results[q.id].pending && !results[q.id].error);

  if (finished && recorded.current !== run.n) {
    recorded.current = run.n;
    recordAttempt(item.id, { earned: t.earned, total: t.total, partial: !!run.only });
  }

  async function checkQuestion(q) {
    if (q.type !== "short_answer") {
      setResults((r) => ({ ...r, [q.id]: { correct: check(q, values[q.id]) } }));
      return;
    }
    setResults((r) => ({ ...r, [q.id]: { pending: true } }));
    try {
      const g = await grade(q, values[q.id]);
      setResults((r) => ({ ...r, [q.id]: { grade: g } }));
    } catch (e) {
      setResults((r) => ({ ...r, [q.id]: { error: `${e.message} Your answer is kept; try again.` } }));
    }
  }

  function again(only) {
    setValues({});
    setResults({});
    setRun((r) => ({ n: r.n + 1, only }));
  }

  const wrong = questions.filter((q) => missed(q, results[q.id])).map((q) => q.id);

  return (
    <div className="quiz">
      <p className="note">
        {t.done} of {questions.length} answered
        {t.done > 0 && <> · {Math.round(t.earned * 10) / 10} of {t.done} points so far</>}
        {run.only && <> · only the questions you missed</>}
      </p>
      {questions.map((q, i) => (
        <Question key={`${run.n}-${q.id}`} q={q} n={i + 1} total={questions.length}
                  value={values[q.id]} result={results[q.id]}
                  onChange={(v) => setValues((s) => ({ ...s, [q.id]: v }))}
                  onCheck={() => checkQuestion(q)} />
      ))}
      {finished && (
        <section className="panel qz-done">
          <div className="panel-head"><h2>Result</h2></div>
          <p className="qz-score">
            {Math.round(t.earned * 10) / 10} / {t.total}
            <span className="note dim"> · {percent(t.earned / t.total)}</span>
          </p>
          <div className="set-actions">
            {wrong.length > 0 && (
              <button className="primary" onClick={() => again(wrong)}>Retry the {wrong.length} you missed</button>
            )}
            <button onClick={() => again(null)}>Retake the whole quiz</button>
          </div>
        </section>
      )}
    </div>
  );
}
