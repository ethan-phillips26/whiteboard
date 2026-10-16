// The chats Claude has had with the student, kept so one can be picked up again. In
// the same store as everything else, so logging out empties it. Writes go one after
// another: a save reads the whole list, and two at once would lose one of them.

import * as store from "./store.js";

const KEY = "claude_chats";
let queue = Promise.resolve();

const exclusive = (job) => {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
};

export async function load() {
  return (await store.getData(KEY)) ?? [];
}

export const save = (chat) => exclusive(async () => {
  const rest = (await load()).filter((c) => c.id !== chat.id);
  await store.write(KEY, [chat, ...rest]);
});

export const remove = (id) => exclusive(async () => {
  await store.write(KEY, (await load()).filter((c) => c.id !== id));
});
