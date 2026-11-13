import assert from "node:assert/strict";
import test from "node:test";
import { SpriteBatch } from "../src/render/gl/batch.ts";

const FLOATS_PER_INSTANCE = 14;

function makeBatch(capacity: number): SpriteBatch {
  const batch = Object.create(SpriteBatch.prototype) as SpriteBatch;
  const gl = {
    ARRAY_BUFFER: 1,
    DYNAMIC_DRAW: 2,
    bindBuffer: () => undefined,
    bufferData: () => undefined,
  };
  Reflect.set(batch, "capacity", capacity);
  Reflect.set(batch, "additiveCapacity", capacity);
  Reflect.set(batch, "data", new Float32Array(capacity * FLOATS_PER_INSTANCE));
  Reflect.set(batch, "additiveData", new Float32Array(capacity * FLOATS_PER_INSTANCE));
  Reflect.set(batch, "normalCount", 0);
  Reflect.set(batch, "additiveCount", 0);
  Reflect.set(batch, "normalBuf", {});
  Reflect.set(batch, "additiveBuf", {});
  Reflect.set(batch, "gl", gl);
  return batch;
}

test("SpriteBatch keeps normal and additive instances in separate buffers", () => {
  const batch = makeBatch(4);
  batch.drawSolidRect(10, 0, 1, 1, [1, 1, 1, 1]);
  batch.drawSolidRect(20, 0, 1, 1, [1, 1, 1, 1], true);
  batch.drawSolidRect(30, 0, 1, 1, [1, 1, 1, 1]);

  const data = Reflect.get(batch, "data") as Float32Array;
  const additive = Reflect.get(batch, "additiveData") as Float32Array;
  assert.equal(Reflect.get(batch, "normalCount"), 2);
  assert.equal(Reflect.get(batch, "additiveCount"), 1);
  assert.deepEqual([data[0], data[FLOATS_PER_INSTANCE]], [10, 30]);
  assert.equal(additive[0], 20);
});

test("SpriteBatch grows its instance buffer instead of dropping quads at capacity", () => {
  const batch = makeBatch(2);
  for (let x = 0; x < 5; x++) batch.drawSolidRect(x, 0, 1, 1, [1, 1, 1, 1]);

  const data = Reflect.get(batch, "data") as Float32Array;
  assert.equal(Reflect.get(batch, "capacity"), 8);
  assert.equal(Reflect.get(batch, "normalCount"), 5);
  assert.equal(data.length, 8 * FLOATS_PER_INSTANCE);
  assert.equal(data[4 * FLOATS_PER_INSTANCE], 4);
});

test("additive growth never resizes the normal buffer", () => {
  const batch = makeBatch(2);
  for (let x = 0; x < 5; x++) batch.drawSolidRect(x, 0, 1, 1, [1, 1, 1, 1], true);

  const data = Reflect.get(batch, "data") as Float32Array;
  const additive = Reflect.get(batch, "additiveData") as Float32Array;
  assert.equal(Reflect.get(batch, "additiveCapacity"), 8);
  assert.equal(Reflect.get(batch, "capacity"), 2);
  assert.equal(data.length, 2 * FLOATS_PER_INSTANCE);
  assert.equal(additive.length, 8 * FLOATS_PER_INSTANCE);
  assert.equal(additive[4 * FLOATS_PER_INSTANCE], 4);
});
