// Floats survive load, copies and save byte-for-byte: a structuredClone'd float (a plain { raw } object) still
// writes back as the number, and cloneData keeps the class.
import assert from 'node:assert/strict';
import { parseSave, serializeSave, cloneData } from '../js/savefile.js';

const text = '{"a":-1.0,"b":0.30000001192092898,"c":[2.50,3],"n":{"trade":{"tradeGap":-1.0}}}';
const d = parseSave(text);
assert.equal(serializeSave(d), text);
d.copy = structuredClone(d.n);
d.kept = cloneData(d.n);
assert.equal(serializeSave(d), text.slice(0, -1) + ',"copy":{"trade":{"tradeGap":-1.0}},"kept":{"trade":{"tradeGap":-1.0}}}');
assert.equal(d.kept.trade.tradeGap.constructor, d.n.trade.tradeGap.constructor);
console.log('savefile OK: floats survive clones and the round trip');
