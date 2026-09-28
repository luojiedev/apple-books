function varint(value: number): Buffer {
  let current = BigInt(value); const bytes: number[] = [];
  while (current > 127n) { bytes.push(Number(current & 127n) | 128); current >>= 7n; }
  bytes.push(Number(current)); return Buffer.from(bytes);
}
export const message = (...fields: Buffer[]) => Buffer.concat(fields);
export const bytes = (number: number, value: Buffer) => message(varint(number * 8 + 2), varint(value.length), value);
export const integer = (number: number, value: number) => message(varint(number * 8), varint(value));
const dictionary = (key: number, id: Buffer) => bytes(1, message(bytes(1, integer(1, key)), bytes(2, bytes(6, bytes(1, id)))));
const object = (id: Buffer, fields: Record<string, Buffer>) => message(bytes(1, id), bytes(3, bytes(4, message(...Object.entries(fields).map(([name, value]) => bytes(1, message(bytes(1, Buffer.from(name)), bytes(2, value))))))));

export function historyFixture(): Buffer {
  const month = Buffer.alloc(16, 1), day = Buffer.alloc(16, 2), actor = Buffer.alloc(16, 3);
  return message(Buffer.from("crdt\x04\x00\x00\x00"), bytes(1, message(bytes(1, Buffer.from("months")), bytes(2, dictionary(202601, month)))),
    bytes(2, object(month, { days: dictionary(15, day), totalTime: bytes(1, bytes(3, integer(1, 3600))) })),
    bytes(2, object(day, { readingTime: bytes(7, bytes(2, bytes(1, message(bytes(1, actor), bytes(2, message(Buffer.from([0]), varint(120))))))) })));
}
