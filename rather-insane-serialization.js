// Rather insane serialization | Spencer Tipping
// Licensed under the terms of the MIT source code license

// Introduction.
// Both simple and complex forms (those with circular references) are stored as
// expressions that, when evaluated, return the values they represent. So, for
// example, consider the value x = [x]; that is, an array that contains itself.
// Serializing this array yields this (as a string):

// | (function () {
//     var _1 = [null];
//     _1[0] = _1;
//     return _1;
//   })()

// Circular reference cases are optimized to produce reasonably compact
// serializations. In particular, the enclosing function is reused when dealing
// with multiple circular references; for instance, the array y = [x = [x], y] is
// serialized like this:

// | (function () {
//     var _1 = [null, null];
//     var _2 = [null];
//     _1[0] = _2;
//     _1[1] = _1;
//     _2[0] = _2;
//     return _1;
//   })()

// Note that this implementation assumes that the .constructor property returns
// appropriate values. This will not be true if values are passed between iframes
// on the same domain (though I would argue that this is a pathological case).

var rather_insane_serialization = {
  serialize: function (x) {
    var refs         = {};
    var marked       = [];
    var initializers = [];
    var id           = 0;

    // Initialize a separate serialization secret for each call here. This makes
    // serialize() re-entrant, though I'm not sure whether that matters.
    for (var secret = '', i = 0; i < 32; ++i)
      secret += (Math.random() * 16 >>> 0).toString(16);

    // Recursive serialization. This does one of two things. For structural types,
    // the values are serialized in terms of literals. For reference types, the
    // 'refs' table is updated with a new entry and 'null' is emitted as the
    // serialized output.
    var visit = function (base, index, x) {
      // Handle these two cases immediately. Null and undefined objects will
      // produce errors when we query their attributes, and because they are value
      // types we can easily encode them as literals without modifying the
      // reference table.
      if (x === void 0) return 'void 0';
      if (x === null)   return 'null';

      // Handle primitive values. These can't have circular references, since we
      // don't serialize attributes of primitive boxes.
      if (x.constructor === Number   || x.constructor === Boolean ||
          x.constructor === Function || x.constructor === RegExp)
        return x.toString();

      if (x.constructor === String)
        return '"' + x.replace(/["\n\\]/g, '\\$1') + '"';

      if (x.constructor === Date)
        return 'new Date(' + +x + ')';

      // At this point we know that x is a complex type (i.e. an array or an
      // object), so we check for circular references. If x has been marked, then
      // we've seen it before; therefore we need to make a reference variable for
      // it and defer serialization.
      if (x[secret]) {
        // The value has already been visited. In this case we emit an initializer
        // and return 'null' as the serialization outcome.
        initializers.push([base, index, x[secret]]);
        return 'null';
      }

      // Mark the object as having been visited. If we encounter further
      // references to it, then they will be serialized as null references and
      // filled in later.
      var x_id = x[secret] = ++id;
      marked.push(x);

      if (x.constructor === Array) {
        for (var pieces = [], i = 0, l = x.length; i < l; ++i)
          pieces.push(visit(x_id, i, x[i]));

        refs[x_id] = '[' + pieces.join(',') + ']';
        return 'null';
      }

      if (x.constructor === Object) {
        var pieces = [];
        for (var k in x)
          if (x.hasOwnProperty(k) && k !== secret)
            pieces.push((/[^A-Za-z$_]/.test(k) ? visit(null, null, k) : k) + ':' +
                        visit(x_id, k, x[k]));

        refs[x_id] = '{' + pieces.join(',') + '}';
        return 'null';
      }

      throw new Error('crossdomain_rpc.serialize.visit: Invalid object: ' + x);
    };

    // Visit the root value. Because it won't be marked, we don't have to worry
    // about providing a valid base or index.
    var base_value = visit(null, null, x);

    // If x has been marked, then we refer to it as a variable. Otherwise we take
    // the simple serialization, since we know that it has no sub-references.
    if (! (x && x[secret])) return base_value;

    // At this point we know that x is either an object or an array. First we
    // write a table of variables (one for each entry in 'refs'), and then we
    // write out the initializers to populate the cross-references.
    var variable_assignments = [];
    for (var k in refs)
      if (refs.hasOwnProperty(k))
        variable_assignments.push('_' + (+k).toString(36) + '=' = refs[k]);

    var initializer_statements = [];
    for (var i = 0, l = initializers.length; i < l; ++i)
      initializer_statements.push(
        '_' + initializers[i][0].toString(36) +
        '[' + visit(null, null, initializers[i][1]) + ']' + '=' +
        '_' + initializers[i][2].toString(36));

    // Generate the closure and surrounding statements.
    var serialization = '(function () {' +
                          'var ' + variable_assignments.join(',') + ';' +
                          initializer_statements.join(';') + ';' +
                          'return ' + '_' + x[secret].toString(36) +
                        '})()';

    // We can't return just yet. First, we have to unmark all of the objects.
    for (var i = 0, l = marked.length; i < l; ++i)
      delete marked[i][secret];

    return serialization;
  },

  deserialize: function (expression) {
    return new Function('return (' + expression + ')')();
  }};

// Generated by SDoc 
