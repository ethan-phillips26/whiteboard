// Native messaging's wire format: each message is a 4-byte little-endian length
// and then that many bytes of UTF-8 JSON, in both directions over stdio.

export function encode(obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}

/** A function to feed stdin chunks to; `onMessage` gets each whole message. */
export function decoder(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0);
      if (buf.length < 4 + n) break;
      const body = buf.subarray(4, 4 + n);
      buf = buf.subarray(4 + n);
      let msg;
      try {
        msg = JSON.parse(body.toString("utf8"));
      } catch {
        continue;
      }
      onMessage(msg);
    }
  };
}
