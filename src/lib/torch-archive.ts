import { unzipSync, zipSync } from "fflate";

const PICKLE_PROTOCOL = 2;
const PICKLE_MARK = Symbol("pickle-mark");

const OP = {
  appendItems: 0x65,
  binFloat: 0x47,
  binGet: 0x68,
  binInt: 0x4a,
  binInt1: 0x4b,
  binInt2: 0x4d,
  binPersId: 0x51,
  binPut: 0x71,
  binUnicode: 0x58,
  emptyDict: 0x7d,
  emptyList: 0x5d,
  emptyTuple: 0x29,
  global: 0x63,
  long1: 0x8a,
  longBinGet: 0x6a,
  longBinPut: 0x72,
  mark: 0x28,
  newFalse: 0x89,
  newTrue: 0x88,
  none: 0x4e,
  proto: 0x80,
  reduce: 0x52,
  setItem: 0x73,
  setItems: 0x75,
  stop: 0x2e,
  tuple: 0x74,
  tuple1: 0x85,
  tuple2: 0x86,
  tuple3: 0x87,
} as const;

type TorchTensorDtype = "float32" | "int32" | "uint8";
type TorchTensorValues = Float32Array | Int32Array | Uint8Array;
export type TorchKey = number | string;
type TorchPrimitive = boolean | null | number | string;

export interface TorchRecord {
  [key: string]: TorchValue;
}

export type TorchObject = Map<TorchKey, TorchValue> | TorchRecord;
export type TorchValue = TorchPrimitive | TorchObject | TorchTensorValue | TorchValue[];

type StorageRef = {
  device: string;
  dtype: TorchTensorDtype;
  key: string;
  size: number;
  type: "storage";
};

type TensorReducer = {
  name: string;
  type: "global";
};

export type TorchTensorValue = {
  dtype: TorchTensorDtype;
  shape: number[];
  type: "tensor";
  values: TorchTensorValues;
};

type ParsedBytes = {
  offset: number;
  view: DataView;
};

type PickleState = {
  memo: Map<number, unknown>;
  offset: number;
  stack: unknown[];
  storageEntries: Record<string, Uint8Array>;
  view: DataView;
};

type WriterState = {
  storages: Array<{
    dtype: TorchTensorDtype;
    key: string;
    values: TorchTensorValues;
  }>;
  writer: ByteWriter;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createTorchTensor(
  dtype: TorchTensorDtype,
  shape: number[],
  values: TorchTensorValues,
): TorchTensorValue {
  return {
    dtype,
    shape,
    type: "tensor",
    values,
  };
}

export function serializeTorchArtifact(root: TorchObject, fileName: string) {
  const writerState: WriterState = {
    storages: [],
    writer: new ByteWriter(),
  };
  const fileStem = stripFinalExtension(fileName);

  writerState.writer.writeUint8(OP.proto);
  writerState.writer.writeUint8(PICKLE_PROTOCOL);
  writePickleValue(root, writerState);
  writerState.writer.writeUint8(OP.stop);

  const entries: Record<string, Uint8Array> = {
    [`${fileStem}/.data/serialization_id`]: encoder.encode(createSerializationId()),
    [`${fileStem}/.format_version`]: encoder.encode("1"),
    [`${fileStem}/.storage_alignment`]: encoder.encode("64"),
    [`${fileStem}/byteorder`]: encoder.encode("little"),
    [`${fileStem}/data.pkl`]: writerState.writer.finish(),
    [`${fileStem}/version`]: encoder.encode("3\n"),
  };

  writerState.storages.forEach((storage) => {
    entries[`${fileStem}/data/${storage.key}`] = typedArrayBytes(storage.values);
  });

  return zipSync(entries, {
    level: 0,
  });
}

export function parseTorchArtifact(bytes: ArrayBuffer | Uint8Array): TorchValue {
  const archiveBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const archive = unzipSync(archiveBytes);
  const dataEntryName = Object.keys(archive).find((entryName) => entryName.endsWith("/data.pkl"));

  if (!dataEntryName) {
    throw new Error("Torch artifact archive is missing data.pkl.");
  }

  const entryPrefix = dataEntryName.slice(0, -"/data.pkl".length);
  const storageEntries = Object.fromEntries(
    Object.entries(archive)
      .filter(([entryName]) => entryName.startsWith(`${entryPrefix}/data/`))
      .map(([entryName, entryBytes]) => [
        entryName.slice(`${entryPrefix}/data/`.length),
        entryBytes,
      ]),
  );
  const pickleState: PickleState = {
    memo: new Map(),
    offset: 0,
    stack: [],
    storageEntries,
    view: new DataView(
      archive[dataEntryName].buffer,
      archive[dataEntryName].byteOffset,
      archive[dataEntryName].byteLength,
    ),
  };

  return parsePickleValue(pickleState);
}

function writePickleValue(value: TorchValue, state: WriterState) {
  if (value == null) {
    state.writer.writeUint8(OP.none);
    return;
  }

  if (typeof value === "boolean") {
    state.writer.writeUint8(value ? OP.newTrue : OP.newFalse);
    return;
  }

  if (typeof value === "number") {
    writePickleNumber(value, state.writer);
    return;
  }

  if (typeof value === "string") {
    writePickleString(value, state.writer);
    return;
  }

  if (Array.isArray(value)) {
    writePickleList(value, state);
    return;
  }

  if (isTorchTensor(value)) {
    writePickleTensor(value, state);
    return;
  }

  writePickleObject(value, state);
}

function writePickleNumber(value: number, writer: ByteWriter) {
  if (Number.isInteger(value)) {
    if (value >= 0 && value <= 0xff) {
      writer.writeUint8(OP.binInt1);
      writer.writeUint8(value);
      return;
    }

    if (value >= 0 && value <= 0xffff) {
      writer.writeUint8(OP.binInt2);
      writer.writeUint16(value);
      return;
    }

    if (value >= -0x8000_0000 && value <= 0x7fff_ffff) {
      writer.writeUint8(OP.binInt);
      writer.writeInt32(value);
      return;
    }

    writer.writeUint8(OP.long1);
    const encoded = encodeBigInt(BigInt(value));
    writer.writeUint8(encoded.length);
    writer.writeBytes(encoded);
    return;
  }

  writer.writeUint8(OP.binFloat);
  writer.writeFloat64(value);
}

function writePickleString(value: string, writer: ByteWriter) {
  const bytes = encoder.encode(value);
  writer.writeUint8(OP.binUnicode);
  writer.writeUint32(bytes.length);
  writer.writeBytes(bytes);
}

function writePickleList(items: TorchValue[], state: WriterState) {
  state.writer.writeUint8(OP.emptyList);
  if (items.length === 0) {
    return;
  }

  state.writer.writeUint8(OP.mark);
  items.forEach((item) => {
    writePickleValue(item, state);
  });
  state.writer.writeUint8(OP.appendItems);
}

function writePickleObject(value: TorchObject, state: WriterState) {
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  state.writer.writeUint8(OP.emptyDict);
  if (entries.length === 0) {
    return;
  }

  state.writer.writeUint8(OP.mark);
  entries.forEach(([key, itemValue]) => {
    writePickleValue(key, state);
    writePickleValue(itemValue as TorchValue, state);
  });
  state.writer.writeUint8(OP.setItems);
}

function writePickleTensor(tensor: TorchTensorValue, state: WriterState) {
  state.writer.writeUint8(OP.global);
  state.writer.writeAsciiLine("torch._utils");
  state.writer.writeAsciiLine("_rebuild_tensor_v2");
  state.writer.writeUint8(OP.mark);
  writeStoragePersistentId(tensor, state);
  writePickleNumber(0, state.writer);
  writePickleTuple(tensor.shape, state);
  writePickleTuple(buildContiguousStride(tensor.shape), state);
  state.writer.writeUint8(OP.newFalse);
  writePickleObject({}, state);
  state.writer.writeUint8(OP.tuple);
  state.writer.writeUint8(OP.reduce);
}

function writeStoragePersistentId(tensor: TorchTensorValue, state: WriterState) {
  const key = String(state.storages.length);
  state.storages.push({
    dtype: tensor.dtype,
    key,
    values: tensor.values,
  });

  state.writer.writeUint8(OP.mark);
  writePickleString("storage", state.writer);
  state.writer.writeUint8(OP.global);
  state.writer.writeAsciiLine("torch");
  state.writer.writeAsciiLine(storageTypeForDtype(tensor.dtype));
  writePickleString(key, state.writer);
  writePickleString("cpu", state.writer);
  writePickleNumber(tensor.values.length, state.writer);
  state.writer.writeUint8(OP.tuple);
  state.writer.writeUint8(OP.binPersId);
}

function writePickleTuple(items: TorchValue[], state: WriterState) {
  if (items.length === 0) {
    state.writer.writeUint8(OP.emptyTuple);
    return;
  }

  state.writer.writeUint8(OP.mark);
  items.forEach((item) => {
    writePickleValue(item, state);
  });
  state.writer.writeUint8(OP.tuple);
}

function parsePickleValue(state: PickleState): TorchValue {
  while (state.offset < state.view.byteLength) {
    const opcode = readUint8(state);

    switch (opcode) {
      case OP.proto: {
        const protocol = readUint8(state);
        if (protocol !== PICKLE_PROTOCOL) {
          throw new Error(`Unsupported pickle protocol ${protocol}.`);
        }
        break;
      }
      case OP.mark: {
        state.stack.push(PICKLE_MARK);
        break;
      }
      case OP.emptyDict: {
        state.stack.push(new Map<TorchKey, TorchValue>());
        break;
      }
      case OP.emptyList: {
        state.stack.push([]);
        break;
      }
      case OP.emptyTuple: {
        state.stack.push([]);
        break;
      }
      case OP.none: {
        state.stack.push(null);
        break;
      }
      case OP.newTrue: {
        state.stack.push(true);
        break;
      }
      case OP.newFalse: {
        state.stack.push(false);
        break;
      }
      case OP.binUnicode: {
        state.stack.push(readUnicodeString(state));
        break;
      }
      case OP.binInt1: {
        state.stack.push(readUint8(state));
        break;
      }
      case OP.binInt2: {
        state.stack.push(readUint16(state));
        break;
      }
      case OP.binInt: {
        state.stack.push(readInt32(state));
        break;
      }
      case OP.long1: {
        const byteCount = readUint8(state);
        state.stack.push(Number(decodeBigInt(readBytes(state, byteCount))));
        break;
      }
      case OP.binFloat: {
        state.stack.push(readFloat64(state));
        break;
      }
      case OP.global: {
        state.stack.push({
          name: `${readAsciiLine(state)} ${readAsciiLine(state)}`,
          type: "global",
        } satisfies TensorReducer);
        break;
      }
      case OP.tuple:
      case OP.tuple1:
      case OP.tuple2:
      case OP.tuple3: {
        state.stack.push(resolveTupleOpcode(opcode, popMarkedValues(state)));
        break;
      }
      case OP.appendItems: {
        const values = popMarkedValues(state);
        const list = state.stack[state.stack.length - 1];
        if (!Array.isArray(list)) {
          throw new Error("APPENDS expected a list.");
        }
        list.push(...(values as TorchValue[]));
        break;
      }
      case OP.setItems: {
        const values = popMarkedValues(state);
        const dict = state.stack[state.stack.length - 1];
        if (!(dict instanceof Map)) {
          throw new Error("SETITEMS expected a mapping.");
        }
        for (let index = 0; index < values.length; index += 2) {
          dict.set(values[index] as TorchKey, values[index + 1] as TorchValue);
        }
        break;
      }
      case OP.setItem: {
        const value = state.stack.pop();
        const key = state.stack.pop();
        const dict = state.stack[state.stack.length - 1];
        if (!(dict instanceof Map)) {
          throw new Error("SETITEM expected a mapping.");
        }
        dict.set(key as TorchKey, value as TorchValue);
        break;
      }
      case OP.binPersId: {
        const persistentId = state.stack.pop();
        state.stack.push(resolvePersistentId(persistentId));
        break;
      }
      case OP.reduce: {
        const args = state.stack.pop();
        const reducer = state.stack.pop();
        state.stack.push(applyReducer(reducer, args, state.storageEntries));
        break;
      }
      case OP.binPut: {
        state.memo.set(readUint8(state), state.stack[state.stack.length - 1]);
        break;
      }
      case OP.longBinPut: {
        state.memo.set(readUint32(state), state.stack[state.stack.length - 1]);
        break;
      }
      case OP.binGet: {
        state.stack.push(readMemoValue(state, readUint8(state)));
        break;
      }
      case OP.longBinGet: {
        state.stack.push(readMemoValue(state, readUint32(state)));
        break;
      }
      case OP.stop: {
        if (state.stack.length !== 1) {
          throw new Error("Unexpected pickle stack depth at STOP.");
        }
        return finalizeParsedValue(state.stack[0]);
      }
      default: {
        throw new Error(`Unsupported pickle opcode 0x${opcode.toString(16)}.`);
      }
    }
  }

  throw new Error("Pickle stream ended before STOP.");
}

function applyReducer(
  reducer: unknown,
  args: unknown,
  storageEntries: Record<string, Uint8Array>,
): unknown {
  if (!reducer || typeof reducer !== "object" || (reducer as TensorReducer).type !== "global") {
    throw new Error("Unsupported pickle reducer.");
  }

  const reducerName = (reducer as TensorReducer).name;
  if (reducerName === "torch._utils _rebuild_tensor_v2") {
    if (!Array.isArray(args) || args.length < 4) {
      throw new Error("Invalid tensor reducer payload.");
    }

    const storage = args[0];
    const storageOffset = Number(args[1] ?? 0);
    const shape = normalizeNumberArray(args[2], "tensor shape");
    const stride = normalizeNumberArray(args[3], "tensor stride");
    return rebuildTensor(storage, storageOffset, shape, stride, storageEntries);
  }

  if (reducerName === "collections OrderedDict") {
    return new Map<TorchKey, TorchValue>();
  }

  if (reducerName === "_codecs encode") {
    if (!Array.isArray(args) || args.length !== 2) {
      throw new Error("Invalid bytes reducer payload.");
    }
    return decodeEncodedBytes(args[0], args[1]);
  }

  throw new Error(`Unsupported pickle reducer "${reducerName}".`);
}

function rebuildTensor(
  storageValue: unknown,
  storageOffset: number,
  shape: number[],
  stride: number[],
  storageEntries: Record<string, Uint8Array>,
) {
  if (
    !storageValue ||
    typeof storageValue !== "object" ||
    (storageValue as StorageRef).type !== "storage"
  ) {
    throw new Error("Tensor reducer received an invalid storage reference.");
  }

  const storage = storageValue as StorageRef;
  const storageBytes = storageEntries[storage.key];
  if (!storageBytes) {
    throw new Error(`Torch artifact is missing storage payload ${storage.key}.`);
  }

  const expectedStride = buildContiguousStride(shape);
  if (!arrayEquals(stride, expectedStride)) {
    throw new Error("Only contiguous tensor storages are supported.");
  }

  const elementCount = shape.reduce((product, value) => product * value, 1);
  const values = sliceStorageValues(storage.dtype, storageBytes, storageOffset, elementCount);

  return {
    dtype: storage.dtype,
    shape,
    type: "tensor",
    values,
  } satisfies TorchTensorValue;
}

function resolvePersistentId(value: unknown): StorageRef {
  if (!Array.isArray(value) || value.length !== 5) {
    throw new Error("Unsupported pickle persistent ID.");
  }

  const [kind, storageType, key, device, size] = value;
  if (kind !== "storage") {
    throw new Error(`Unsupported persistent kind "${String(kind)}".`);
  }
  if (
    !storageType ||
    typeof storageType !== "object" ||
    (storageType as TensorReducer).type !== "global"
  ) {
    throw new Error("Persistent storage reference is missing its storage type.");
  }
  if (typeof key !== "string" || typeof device !== "string" || typeof size !== "number") {
    throw new Error("Persistent storage reference is invalid.");
  }

  return {
    device,
    dtype: dtypeForStorageType((storageType as TensorReducer).name),
    key,
    size,
    type: "storage",
  };
}

function finalizeParsedValue(value: unknown): TorchValue {
  if (value instanceof Map) {
    const keys = [...value.keys()];
    if (keys.every((key) => typeof key === "string")) {
      return Object.fromEntries(
        [...value.entries()].map(([key, entryValue]) => [key, finalizeParsedValue(entryValue)]),
      );
    }

    return new Map(
      [...value.entries()].map(([key, entryValue]) => [key, finalizeParsedValue(entryValue)]),
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => finalizeParsedValue(item));
  }

  return value as TorchValue;
}

function decodeEncodedBytes(value: unknown, encoding: unknown) {
  if (typeof value !== "string" || typeof encoding !== "string") {
    throw new Error("Encoded bytes payload is invalid.");
  }
  if (encoding !== "latin1") {
    throw new Error(`Unsupported bytes encoding "${encoding}".`);
  }

  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}

function resolveTupleOpcode(opcode: number, values: unknown[]) {
  if (opcode === OP.tuple1) {
    return [values[values.length - 1]];
  }
  if (opcode === OP.tuple2) {
    return values.slice(-2);
  }
  if (opcode === OP.tuple3) {
    return values.slice(-3);
  }
  return values;
}

function readMemoValue(state: PickleState, index: number) {
  const value = state.memo.get(index);
  if (value === undefined) {
    throw new Error(`Pickle memo entry ${index} is missing.`);
  }
  return value;
}

function popMarkedValues(state: PickleState) {
  const values: unknown[] = [];

  while (state.stack.length > 0) {
    const value = state.stack.pop();
    if (value === PICKLE_MARK) {
      return values.reverse();
    }
    values.push(value);
  }

  throw new Error("Pickle MARK not found.");
}

function normalizeNumberArray(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "number")) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function sliceStorageValues(
  dtype: TorchTensorDtype,
  storageBytes: Uint8Array,
  storageOffset: number,
  elementCount: number,
): TorchTensorValues {
  const bytesPerElement = dtype === "float32" || dtype === "int32" ? 4 : 1;
  const start = storageOffset * bytesPerElement;
  const end = start + elementCount * bytesPerElement;
  const storageSlice = storageBytes.slice(start, end);
  const parsed = createParsedBytes(storageSlice);

  if (dtype === "float32") {
    const values = new Float32Array(elementCount);
    for (let index = 0; index < elementCount; index += 1) {
      values[index] = parsed.view.getFloat32(index * 4, true);
    }
    return values;
  }

  if (dtype === "int32") {
    const values = new Int32Array(elementCount);
    for (let index = 0; index < elementCount; index += 1) {
      values[index] = parsed.view.getInt32(index * 4, true);
    }
    return values;
  }

  return storageSlice;
}

function isTorchTensor(value: TorchValue): value is TorchTensorValue {
  return (
    typeof value === "object" &&
    value != null &&
    "type" in value &&
    value.type === "tensor" &&
    Array.isArray(value.shape) &&
    "values" in value
  );
}

function storageTypeForDtype(dtype: TorchTensorDtype) {
  if (dtype === "float32") {
    return "FloatStorage";
  }
  if (dtype === "int32") {
    return "IntStorage";
  }
  return "ByteStorage";
}

function dtypeForStorageType(storageType: string): TorchTensorDtype {
  if (storageType === "torch FloatStorage") {
    return "float32";
  }
  if (storageType === "torch IntStorage") {
    return "int32";
  }
  if (storageType === "torch ByteStorage") {
    return "uint8";
  }
  throw new Error(`Unsupported storage type "${storageType}".`);
}

function buildContiguousStride(shape: number[]) {
  if (shape.length === 0) {
    return [];
  }

  const stride = new Array<number>(shape.length);
  let running = 1;
  for (let index = shape.length - 1; index >= 0; index -= 1) {
    stride[index] = running;
    running *= shape[index] ?? 1;
  }
  return stride;
}

function stripFinalExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/u, "");
}

function typedArrayBytes(values: TorchTensorValues) {
  return new Uint8Array(
    values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength),
  );
}

function createSerializationId() {
  const now = Date.now().toString();
  const random = Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, "0");
  return `${now}${random}`;
}

function encodeBigInt(value: bigint) {
  if (value === 0n) {
    return Uint8Array.of(0);
  }

  let nextValue = value;
  const bytes: number[] = [];
  const negative = nextValue < 0n;

  while (nextValue !== 0n && nextValue !== -1n) {
    bytes.push(Number(nextValue & 0xffn));
    nextValue >>= 8n;
  }

  const lastByte = bytes[bytes.length - 1] ?? 0;
  const signBitSet = (lastByte & 0x80) !== 0;
  if ((!negative && signBitSet) || (negative && !signBitSet)) {
    bytes.push(negative ? 0xff : 0x00);
  }

  return Uint8Array.from(bytes);
}

function decodeBigInt(bytes: Uint8Array) {
  if (bytes.length === 0) {
    return 0n;
  }

  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  }

  if ((bytes[bytes.length - 1] ?? 0) & 0x80) {
    const bitCount = BigInt(bytes.length * 8);
    value -= 1n << bitCount;
  }

  return value;
}

function createParsedBytes(bytes: Uint8Array): ParsedBytes {
  return {
    offset: 0,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  };
}

function readUint8(state: PickleState | ParsedBytes) {
  const value = state.view.getUint8(state.offset);
  state.offset += 1;
  return value;
}

function readUint16(state: PickleState | ParsedBytes) {
  const value = state.view.getUint16(state.offset, true);
  state.offset += 2;
  return value;
}

function readUint32(state: PickleState | ParsedBytes) {
  const value = state.view.getUint32(state.offset, true);
  state.offset += 4;
  return value;
}

function readInt32(state: PickleState | ParsedBytes) {
  const value = state.view.getInt32(state.offset, true);
  state.offset += 4;
  return value;
}

function readFloat64(state: PickleState | ParsedBytes) {
  const value = state.view.getFloat64(state.offset, false);
  state.offset += 8;
  return value;
}

function readBytes(state: PickleState | ParsedBytes, length: number) {
  const bytes = new Uint8Array(state.view.buffer, state.view.byteOffset + state.offset, length);
  state.offset += length;
  return new Uint8Array(bytes);
}

function readUnicodeString(state: PickleState) {
  const byteLength = readUint32(state);
  return decoder.decode(readBytes(state, byteLength));
}

function readAsciiLine(state: PickleState) {
  const bytes: number[] = [];
  while (state.offset < state.view.byteLength) {
    const next = readUint8(state);
    if (next === 0x0a) {
      return String.fromCharCode(...bytes);
    }
    bytes.push(next);
  }
  throw new Error("Unexpected end of pickle line.");
}

function arrayEquals(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  finish() {
    const output = new Uint8Array(this.length);
    let offset = 0;
    this.chunks.forEach((chunk) => {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  }

  writeAsciiLine(value: string) {
    this.writeBytes(encoder.encode(`${value}\n`));
  }

  writeBytes(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  writeFloat64(value: number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, false);
    this.writeBytes(bytes);
  }

  writeInt32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    this.writeBytes(bytes);
  }

  writeUint8(value: number) {
    this.writeBytes(Uint8Array.of(value & 0xff));
  }

  writeUint16(value: number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    this.writeBytes(bytes);
  }

  writeUint32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.writeBytes(bytes);
  }
}
