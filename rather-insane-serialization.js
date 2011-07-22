// Rather insane serialization | Spencer Tipping
// Licensed under the terms of the MIT source code license


// Introduction.
// Rather Insane Serialization serves two purposes. One is to provide a reasonably
// complete serialization/deserialization function that knows what to do with
// non-JSON data types, circular references, and other such things. The other is to
// provide a more compact format than JSON, especially for stuff like numerical
// data. Here is the general usage pattern:

// | rather_insane_serialization.encode(value) -> string
//   rather_insane_serialization.decode(string) -> value

// The serialization output consists entirely of serializable characters and
// newlines, and the newlines can be mangled or deleted without affecting the
// deserialized data.


// Serialization bytecode.
// The first incarnation of this system used Javascript code as the serialization
// format. So the deserializer simply evaluated the serialized data and returned
// the result. This, of course, had several problems. First, it was insecure and
// unnecessarily slow. Second, it required a full Javascript parser and interpreter
// to deserialize stuff. Finally, it produced serialized data that was much larger
// than theoretically necessary.

// This version fixes those problems by using a compression-aware bytecode format.
// The idea here is similar to the original format in that the serialized data is a
// stream of commands to reconstruct the original, but distinct in that the
// interpreter can be implemented relatively easily in any language.

// All characters in the generated bytecode are printable, and by default the
// serializer inserts linebreaks every 72 characters (though these linebreaks, as
// well as any other whitespace, are ignored by the deserializer).

// Generated bytecode has a uniform format: First, a constant table is emitted,
// then a graph of references connects the constants together.

// Sometimes there are no reference types; that is, no functions, objects, or
// arrays. In this case the serialization is just a primitive value, so no constant
// table is required. This is encoded by emitting a constant table with size zero
// (the '!' character); the next value is considered to be a literal in the format
// described below and is returned immediately. There is no reference graph in this
// case.


// Constant table.
// The constant table begins with three numbers. The first is the number of
// constants that are present, the second is the number of arrays to create, and
// the third is the number of objects to create. After this, the reference graph
// indicates the links between constants.

// The bytecode is designed for compactness, so it contains a lot of arithmetic
// coding. In particular, integers are encoded in base 94 and floating point
// numbers are encoded in base 94 with two base-94 characters allocated for the
// exponent and the mantissa and exponent signs. All encodings are big-endian.

// The first few entries of the constant table are fixed and are not serialized.
// They are:

// | 0: false              4: NaN
//   1: true               5: +infinity
//   2: null               6: -infinity
//   3: undefined

// Numbers have several different prefixes depending on the amount of information
// required to encode them. Integers are coded with a letter describing both the
// sign and the number of base-94 digits that are required to fully encode the
// value. The largest integer possible in Javascript is 53 bits plus one bit for
// the sign, and each base-94 digit encodes 6.55 bits of entropy, so an integer
// will require between one and nine characters. Thus there are 18 prefixes for
// integers: abcdefghi (for positive one to nine byte encodings, respectively), and
// ABCDEFGHI (for negative one to nine byte encodings). Zero is encoded as the
// digit '0'.

// Floating point numbers are more straightforward to encode because two base-94
// bytes (an entropy of 8836) is enough information to encode the exponent (entropy
// of 308), exponent sign (entropy of 2), and mantissa sign (entropy of 2). The
// remaining entropy of 7.17 is used to encode the number of bytes used to
// represent the mantissa -- because the mantissa contains up to 53 bits, the
// seven values map to 1, 2, 3, 4, 5, 7, and 9 bytes. The prefix for floating-point
// numbers is 'j'.

// Strings are escape-encoded and are prefixed by their length. This means that 84
// characters map directly to themselves, and there are ten escape prefixes. The
// first two escape prefixes each take one following base-94 character, thus
// encoding a combined entropy of 188. This two-byte escape is used for character
// codes between 0 and 255 inclusive (remember that we don't need to worry about 84
// of those characters). The prefix for strings is '$'.

// Unicode characters are encoded as three-byte escapes; there are eight prefixes
// followed by two base-94 characters. (This has a total entropy of 70688, which is
// sufficient to encode the 65280 remaining possibilities.)

// The two-byte escape prefixes are ! and ", and the three-byte escape prefixes are
// #, $, %, &, ', (, ), and *. This leaves a contiguous range of ASCII characters
// between 43 and 126 inclusive; these are all encoded verbatim.

// String encoding is also used for regular expressions. The only difference here
// is that there are several different regexp prefixes, one to encode each
// configuration of flags. The prefixes and flag combinations are:

// | r: /foo/      v: /foo/g
//   s: /foo/i     w: /foo/gi
//   t: /foo/m     x: /foo/gm
//   u: /foo/mi    y: /foo/gmi

// Nonstandard flags such as the 'y' in Firefox 3 are not serialized.

// Dates are encoded in milliseconds since the epoch, which requires 7 base-94
// characters. There is only one date prefix, 'J'.

// Functions are encoded as strings but have different prefixes. Their properties
// are referenced from the reference section, where they are treated as objects for
// the purposes of edge connections (see 'Reference section' below). The function
// prefix is '#'.

// In addition to literal constants, the constant table encodes the number of
// arrays and objects that exist. These are then referenced and made into a graph
// in the reference section.


// Reference section.
// This section forms a graph from the objects in the constant table. It consists
// of a series of base-94 numbers, each one wide enough to address any constant.
// These numbers form a series of edge descriptions. Each edge description looks
// like this:

// | <object index> <number of edges> <edge> <edge> ... <edge>

// If <object index> refers to an array, then each edge is just an index into the
// constant table. Otherwise, each edge is a pair of constant table indexes; the
// first is a string to encode the slot, and the second is the value that the slot
// refers to. (So, for example, {foo: 'bar'} would have one edge whose slot index
// points to the string 'foo' and whose value index points to the string 'bar'.)

// The first entry in the reference section is the result of deserialization.


// Radix entropy coder.
// Usage: radix_code(10)                   // -> '+'
//        radix_code('+')                  // -> 10

var radix_encode = function (n, length) {
  // This function can return empty strings. To prevent this, pass in a value
  // for 'length'; the resulting number will be padded out to at least this many
  // characters.
  //
  // Note that 'n' must be positive for this function to work correctly.

  for (var digits = []; n; n = Math.floor(n / 94))
    digits.unshift(String.fromCharCode(33 + n % 94));

  while (length && digits.length < length)
    digits.unshift('!');

  return digits.join('');
};

var radix_decode = function (digits) {
  // Force floating point calculations in case integer overflow doesn't work
  // properly.
  for (var n = 0, base = 1.0,
           i = digits.length - 1; i >= 0; base *= 94, --i)
    n += (digits.charCodeAt(i) - 33) * base;
  return n;
};

var radix_code = function (x) {
  return x.constructor === String ? radix_decode(x) :
                                    radix_encode(x);
};

var radix_entropy = function (n) {
  return Math.floor(Math.log(n) / Math.log(94));
};


// Escape entropy coder.
// Usage: escape_encode('string')          // -> 'escaped'
//        escape_decode('escaped')         // -> 'string'

var escape_encode = function (s) {
  // Most characters pass through normally. Escape characters are handled by a
  // specialized radix coder. The ASCII passthrough range is 43 - 126
  // (inclusive); characters 33 - 42 are escape characters.

  for (var result = [],
           i = 0, l = s.length; i < l; ++i) {
    var c = s.charCodeAt(i);

    // Literal case: inside the passthrough range.
    if (c >= 43 && c <= 126) result.push(s.charAt(i));
    else

    // Two byte escape case: between 0 and 42. In this case we prepend the
    // escape character and radix-code c into base 94.
    if (c <= 42) result.push('!' + String.fromCharCode(33 + c));
    else

    // Two byte escape case: still prefixed with !, but not in the low range. In
    // this case we add 43, since that entropy has already been used.
    if (c <= 126 + 84 - 43) result.push('!' + String.fromCharCode(33 + c - 126 + 43));
    else

    // Two byte escape case: prefixed with ", so subtract 94 from the coded
    // number. (This follows because we're in base 94.)
    if (c <= 255) result.push('"' + String.fromCharCode(33 + c - 126 + 43 - 94));
    else

    // Three byte escape case: we can radix-code c, but we need to bump the
    // first character by two positions (since the zero and one slots are
    // already filled by ! and "). To do this we simply add 2 * 94 * 94 to c.
    result.push(radix_code(2 * 94 * 94 + c));
  }

  return result.join('');
};

var escape_decode = function (s) {
  for (var result = [],
           i = 0, l = s.length; i < l; ++i) {
    var c = s.charCodeAt(i);

    // Invalid character: just skip these.
    if (c <= 32 || c >= 127) continue;
    else

    // Two-byte escape case: radix-decode and handle the break in the piecewise
    // function. (See the various two-byte escape cases in the encoder for
    // insight into why we need this.)
    if (c <= 34) {
      var n = radix_code(s.charAt(i) + s.charAt(++i));
      if (n > 43) n += 126 - 43;
      result.push(String.fromCharCode(n));
    }
    else

    // Three-byte escape case: radix-decode and subtract 2 * 94 * 94.
    if (c <= 42) result.push(String.fromCharCode(-2 * 94 * 94 +
                                                 radix_code(s.charAt(i) +
                                                            s.charAt(++i) +
                                                            s.charAt(++i))));
    else

    // Regular case: append the character verbatim.
    result.push(s.charAt(i));
  }

  return result.join('');
};


// Integer encoding.
// This is just a radix encoding with a length/sign prefix.

var integer_encode = function (n) {
  var digits = radix_code(Math.abs(n));
  var prefix = String.fromCharCode(n ? n > 0 ? 97 + digits.length :
                                               65 + digits.length : 48);
  return prefix + digits;
};

var integer_decode = function (s, i) {
  var negative = s.charCodeAt(i) & 32;
  var length   = s.charAt(i).toUpperCase().charCodeAt(0) - 65;
  var n        = radix_code(s.substr(i + 1, length));
  return [n, length + 1];
};


// String encoding.
// This is just escape encoding, except that the length and a '$' string prefix are
// both prepended to the result.

var string_encode = function (s) {
  var escaped       = escape_encode(s);
  var length_prefix = radix_encode(escaped.length, 5);
  return '$' + length_prefix + escaped;
};

var string_decode = function (s, i) {
  var length = radix_code(s.substr(i + 1, 5));
  var string = escape_decode(s.substr(i + 6, length));
  return [string, length + 6];
};


// Regular expression encoding.
// This is just like string encoding, but the prefix varies depending on the flags.
// There are also fewer digits used to encode the length, since regexps top out at
// 30M characters or so (and that's on Chrome, which has the highest tolerance for
// this kind of thing). This means that we need only four digits.

var regexp_encode = function (r) {
  var multiples     = {g: 4, m: 2, i: 1};
  var parsed        = /^\/(.*)\/([gim]*)$/.exec(r.toString());
  var escaped       = escape_encode(parsed[1]);
  var length_prefix = radix_encode(escaped.length, 4);

  for (var flags = 0, flag_string = parsed[2],
           i = 0, l = flag_string.length; i < l; ++i)
    flags += multiples[flag_string.charAt(i)];

  return String.fromCharCode(114 + flags) + length_prefix + escaped;
};

var regexp_decode = function (s, i) {
  var flag_mask = s.charCodeAt(i) - 114;
  var flags     = [flag_mask & 1 ? 'i' : '',
                   flag_mask & 2 ? 'm' : '',
                   flag_mask & 4 ? 'g' : ''].join('');
  var length    = radix_code(s.substr(i + 1, 4));
  var content   = escape_decode(s.substr(i + 5, length));

  return [new RegExp(content, flags), length + 5];
};


// Floating-point encoding.
// This is a fun one. It uses some ad-hoc floating-point manipulation code and a
// tuple entropy coder to pack lots of data into the first two bytes of the
// serialization.

// You can only encode valid floating-point numbers, which conspicuously don't
// include infinity, negative infinity, or NaN. It also doesn't handle 0, which has
// its own encoding.

var float_encode = function (x) {
  // First determine the mantissa sign and flip it if necessary.
  var negative = x !== (x = Math.abs(x));

  // Next grab the floating-point exponent. To do this, we normalize the
  // mantissa to represent a 53-bit integer whose highest bit is always set.
  var log_2    = Math.log(2);
  var exponent = Math.floor(Math.log(x) / log_2) - 53;
  var mantissa = x / Math.exp(exponent * log_2) - Math.exp(53 * log_2);

  // We sometimes lose a few bits due to rounding error.
  if (mantissa < 0) mantissa = 0;

  // Now radix-code the mantissa, and always use 8 bytes to represent it.
  var encoded_mantissa = radix_encode(Math.round(mantissa), 8);

  // Radix-code the exponent, exponent sign, and mantissa sign.
  var exponent_negative = exponent !== (exponent = Math.abs(exponent));
  var encoded_exponent  = radix_encode(+negative + +exponent_negative * 2 +
                                       exponent * 4, 2);

  return 'j' + encoded_exponent + encoded_mantissa;
};

var float_decode = function (s, i) {
  var log_2          = Math.log(2);
  var exponent_block = radix_code(s.substr(i + 1, 2));
  var mantissa_block = radix_code(s.substr(i + 3, 8)) + Math.exp(53 * log_2);

  var exponent = (exponent_block >>> 4) * (exponent_block & 2 ? -1 : 1);

  return [mantissa_block * Math.exp(exponent * log_2) *
                           (exponent_block & 1 ? -1 : 1),
          11];
};

// Generated by SDoc 
