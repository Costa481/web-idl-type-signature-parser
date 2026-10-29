import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInterface } from '../src/index.js';

test('parses a basic interface with an attribute and a method', () => {
  const src = `
    interface Example {
      attribute long value;
      long compute(DOMString input);
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.name, 'Example');
  assert.equal(result.attributes.length, 1);
  assert.deepEqual(result.attributes[0], { name: 'value', type: 'long', readonly: false });
  assert.equal(result.methods.length, 1);
  assert.deepEqual(result.methods[0], {
    name: 'compute',
    returnType: 'long',
    parameters: [{ name: 'input', type: 'DOMString', optional: false }],
  });
});

test('handles readonly attributes', () => {
  const src = `
    interface Node {
      readonly attribute DOMString nodeName;
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.name, 'Node');
  assert.equal(result.attributes[0].readonly, true);
  assert.equal(result.attributes[0].type, 'DOMString');
});

test('extracts parameter names and types', () => {
  const src = `
    interface Math {
      double add(double a, double b);
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.methods[0].name, 'add');
  assert.equal(result.methods[0].parameters.length, 2);
  assert.equal(result.methods[0].parameters[0].name, 'a');
  assert.equal(result.methods[0].parameters[1].type, 'double');
});

test('handles no-parameter methods', () => {
  const src = `
    interface Clock {
      DOMString now();
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.methods[0].parameters.length, 0);
});

test('preserves generic type syntax in attributes', () => {
  const src = `
    interface Store {
      attribute FrozenArray<Element> children;
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.attributes[0].type, 'FrozenArray<Element>');
  assert.equal(result.attributes[0].name, 'children');
});

test('parses methods with generic parameter types', () => {
  const src = `
    interface Util {
      void process(sequence<long> items);
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.methods[0].parameters[0].type, 'sequence<long>');
  assert.equal(result.methods[0].parameters[0].name, 'items');
});

test('strips block comments before parsing', () => {
  const src = `
    interface Doc {
      /* this should be ignored: attribute long ghost; */
      attribute long real;
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.attributes.length, 1);
  assert.equal(result.attributes[0].name, 'real');
});

test('ignores extended attributes on members', () => {
  const src = `
    interface Window {
      [Exposed=Window] attribute DOMString name;
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.attributes[0].name, 'name');
  assert.equal(result.attributes[0].type, 'DOMString');
});

test('returns null name when no interface is found', () => {
  assert.deepEqual(parseInterface('not idl at all'), {
    name: null,
    attributes: [],
    methods: [],
  });
});

test('handles optional parameters', () => {
  const src = `
    interface Dialog {
      void show(optional DOMString message);
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.methods[0].parameters[0].optional, true);
  assert.equal(result.methods[0].parameters[0].type, 'DOMString');
});

test('marks non-optional parameters as optional=false', () => {
  const src = `
    interface S {
      void f(long x);
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.methods[0].parameters[0].optional, false);
});

test('handles interface with inheritance', () => {
  const src = `
    interface Child : Parent {
      attribute long age;
    };
  `;
  const result = parseInterface(src);
  assert.equal(result.name, 'Child');
  assert.equal(result.attributes.length, 1);
});
