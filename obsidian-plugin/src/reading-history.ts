interface Field { number: number; wire: number; value: bigint; data: Buffer }
type Message = Field[];
type ObjectFields = Map<string, Field>;
export interface History { months: Map<number, number>; years: number[]; seconds: number }

function varint(data: Buffer, start: number): [bigint, number] {
  let value = 0n;
  for (let i = 0; i < 10; i++) {
    const byte = data[start + i];
    if (byte === undefined || (i === 9 && byte > 1)) throw new Error("无效的阅读历史 varint。");
    value |= BigInt(byte & 127) << BigInt(i * 7);
    if (!(byte & 128)) return [value, start + i + 1];
  }
  throw new Error("阅读历史 varint 超出范围。");
}

function parse(data: Buffer): Message {
  const result: Message = [];
  let offset = 0;
  while (offset < data.length) {
    const [key, next] = varint(data, offset);
    offset = next;
    const number = Number(key >> 3n), wire = Number(key & 7n);
    if (!number || number > 536870911) throw new Error("无效的阅读历史字段。");
    const field: Field = { number, wire, value: 0n, data: Buffer.alloc(0) };
    if (wire === 0) [field.value, offset] = varint(data, offset);
    else {
      let length: number;
      if (wire === 2) {
        const [size, end] = varint(data, offset);
        if (size > BigInt(data.length)) throw new Error("阅读历史字段长度超出范围。");
        length = Number(size); offset = end;
      } else if (wire === 1) length = 8;
      else if (wire === 5) length = 4;
      else throw new Error("不支持的阅读历史 wire type。");
      if (offset + length > data.length) throw new Error("阅读历史数据被截断。");
      field.data = data.subarray(offset, offset + length); offset += length;
    }
    result.push(field);
  }
  return result;
}

function first(message: Message, number: number): Field | undefined { return message.find(field => field.number === number); }
function child(field?: Field): Message {
  if (!field || field.wire !== 2) return [];
  try { return parse(field.data); } catch { return []; }
}
function walk(message: Message, visit: (message: Message) => void, depth = 0): void {
  if (depth > 32) throw new Error("阅读历史嵌套层数超过上限。");
  visit(message);
  for (const field of message) if (field.wire === 2) {
    const children = child(field);
    if (children.length) walk(children, visit, depth + 1);
  }
}

function references(field?: Field): Map<number, string> {
  const result = new Map<number, string>();
  walk(child(field), candidate => {
    const key = first(child(first(candidate, 1)), 1);
    if (!key || key.wire !== 0 || key.value > 99999999n) return;
    let id: string | undefined;
    walk(child(first(candidate, 2)), value => {
      for (const reference of value.filter(item => item.number === 6)) {
        const objectID = first(child(reference), 1)?.data;
        if (!id && objectID?.length === 16) id = objectID.toString("hex");
      }
    });
    if (id) result.set(Number(key.value), id);
  });
  return result;
}

function register(field?: Field): bigint {
  const value = first(child(first(child(first(child(field), 1)), 3)), 1);
  return value?.wire === 0 ? value.value : 0n;
}

function counter(field?: Field): bigint {
  const components = child(first(child(first(child(field), 7)), 2));
  let total = 0n;
  for (const component of components.filter(item => item.number === 1)) {
    const message = child(component);
    const id = first(message, 1)?.data, encoded = first(message, 2)?.data;
    if (id?.length !== 16 || !encoded || encoded.length < 2) continue;
    const [amount] = varint(encoded, 1);
    total += encoded[0] === 0 ? amount : -amount;
  }
  return total;
}

export function decodeHistory(input: Uint8Array): History {
  const data = Buffer.from(input);
  if (data.length < 8 || data.toString("ascii", 0, 4) !== "crdt" || data.readUInt32LE(4) !== 4) throw new Error("不支持的阅读历史 CRDT 格式（需要版本 4）。");
  const root = parse(data.subarray(8));
  const objects = new Map<string, ObjectFields>();
  for (const field of root.filter(item => item.number === 2)) {
    const object = child(field), id = first(object, 1)?.data;
    if (id?.length !== 16) continue;
    const fields: ObjectFields = new Map();
    for (const container of child(first(object, 3)).filter(item => item.number === 4)) {
      for (const entry of child(container).filter(item => item.number === 1)) {
        const message = child(entry), name = first(message, 1), value = first(message, 2);
        if (name && value) fields.set(name.data.toString("utf8"), value);
      }
    }
    objects.set(id.toString("hex"), fields);
  }
  let monthsField: Field | undefined;
  walk(root, message => {
    if (!monthsField && first(message, 1)?.data.toString("utf8") === "months") monthsField = first(message, 2);
  });
  const months = new Map<number, number>();
  for (const [key, id] of references(monthsField)) {
    const month = objects.get(id);
    if (!month) continue;
    let seconds = register(month.get("totalTime"));
    for (const dayID of references(month.get("days")).values()) seconds += counter(objects.get(dayID)?.get("readingTime"));
    if (seconds < 0n || seconds > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("阅读时长超出有效范围。");
    months.set(key, Number(seconds));
  }
  if (!months.size) throw new Error("阅读历史中没有可读取的月份。");
  return { months, years: [...new Set([...months.keys()].map(key => Math.floor(key / 100)))].sort((a, b) => b - a), seconds: [...months.values()].reduce((a, b) => a + b, 0) };
}
