# web-idl-type-signature-parser

A small parser that extracts the interface name, attribute types, and method signatures from a single Web IDL interface definition.

```js
import { parseInterface } from 'web-idl-type-signature-parser';

const result = parseInterface(`
  interface Element {
    readonly attribute DOMString tagName;
    Element querySelector(DOMString selector);
  };
`);

console.log(result.name);        // "Element"
console.log(result.attributes);  // [{ name: 'tagName', type: 'DOMString', readonly: true }]
console.log(result.methods);     // [{ name: 'querySelector', returnType: 'Element',
                                 //   parameters: [{ name: 'selector', type: 'DOMString', optional: false }] }]
```

## Why this exists

When you need to know which attributes and methods an interface exposes — for documentation generation, stub writing, or quick sanity checks — pulling in a full Web IDL toolchain is overkill. This library takes a single `interface { ... }` block and returns a plain object with `name`, `attributes`, and `methods`. It has no dependencies and makes no attempt to validate the IDL against the specification; it assumes the input is already syntactically reasonable.

The trade-off is scope: it parses one interface at a time, not whole `.idl` documents. Dictionaries, enums, callbacks, and `partial interface` are out of scope. If you need those, use a spec-compliant parser.

## Edge cases worth knowing

Extended attributes like `[Exposed=Window]` are stripped from members before parsing, so they will not appear in the output. Generic types such as `sequence<long>` and `FrozenArray<Element>` are preserved intact because the tokenizer tracks angle-bracket depth. Block comments (`/* ... */`) are removed early so a type name mentioned inside a comment never leaks into the parsed members; line comments (`//`) are intentionally left alone because they are not part of the grammar this library targets.
