//
// bracket.js Javascript Database 
// https://github.com/kristopolous/db.js
//
// Copyright 2011 - 2015, Chris McKenzie
// Dual licensed under the MIT or GPL Version 2 licenses.
//
// Looking under the hood are you? What a fun place to be.
//
// Let's break this down:
//
// 1. since there are no dependencies, I have to have nice
//    underscore and jquery like things myself.
//
// 2. A few database specific tricks.
//
// 3. Trace and debug handlers
//
// 4. Now we get into the core top level functions. These
//    run agnostic of a specific database and work
//    holistically. They include things like find.
//
// 5. The database instance.
//
// 6. Finally a hook that exposes the internal functions
//    outward, plus a few other inline ones that don't get
//    used internally.
var bracket = (function(){
  var 
    // undefined
    _u,

    // prototypes and short cuts
    _slice = function(m){ 
      return Array.prototype.slice.call(m);
    },
    arrify = function(arg) {
      return map(
        _slice(arg), 
        function(m) {
          return _slice(m);
        }
      );
    },
    toString = Object.prototype.toString,

    // For computing set differences
    _stainID = 0,
    _stainKey = '_4ab92bf03191c5',
    _dbIx = 0,

    // type checking system
    _ = {
      // from underscore.js {
      isFun: function(obj) { return !!(obj && obj.constructor && obj.call && obj.apply) },
      isBrk: function(obj) { return obj instanceof bracket },
      isStr: function(obj) { return !!(obj === '' || (obj && obj.charCodeAt && obj.substr)) },
      isScalar: function(obj) { return _.isStr(obj) || _.isNum(obj) || _.isBool(obj) },
      isNum: function(obj) { return toString.call(obj) === '[object Number]' },
      isArr: [].isArray || function(obj) { return toString.call(obj) === '[object Array]' },
      isUndef: function(obj) { return isNaN(obj) || (obj === null) || (obj === undefined) },
      isBool: function(obj){
        return obj === true || obj === false || toString.call(obj) == '[object Boolean]';
      },
      // } end underscore.js
      // from jquery 1.5.2's type
      isObj: function( obj ){
        if(_.isBool(obj) || _.isFun(obj) || _.isStr(obj) || _.isNum(obj) || _.isArr(obj)) {
          return false;
        }
        return obj == null ? 
          String( obj ) == 'object' : 
          toString.call(obj) === '[object Object]' || true ;
      }
    },

    // functions that may have native shortcuts
    indexOf = [].indexOf ? 
      function(array, item) { 
        return array.indexOf(item) 
      } :

      function(array, item) {
        for(var i = array.length - 1; 
          (i != -1) && (item != array[i]);
          i--
        ) {};

        return i;
      },

    keys = Object.keys || function (obj) {
      var ret = [];

      for(var key in obj) {
        ret.push(key);
      }

      return ret;
    },

    values = function (obj) {
      return map(
        keys(obj), function(key) { 
          return obj[key];
        }
      );
    },

    mapSoft = function(array, cb) {
      console.log(array, cb);
      var ret = [];

      for ( var i = 0, len = array.length; i < len; i++ ) { 
        ret.push(cb(array[i], i));
      }

      return ret;
    },

    map = [].map ?
      function(array, cb) { 
        return array.map(cb) 
      } : mapSoft,

    // each is a complex one
    each = [].forEach ?
      function (obj, cb) {
        // Try to return quickly if there's nothing to do.
        if (_.isArr(obj)) { 
          if (obj.length === 0) { return; }
          obj.forEach(cb);
        } else if(_.isScalar(obj)) {
          cb(obj);
        } else {
          for( var key in obj ) {
            cb(key, obj[key]);
          }
        }
      } :

      function (obj, cb) {
        // Try to return quickly if there's nothing to do.
        if (obj.length === 0) { return; }
        if (_.isArr(obj)) {
          for ( var i = 0, len = obj.length; i < len; i++ ) { 
            cb(obj[i], i);
          }
        } else {
          for( var key in obj ) {
            cb(key, obj[key]);
          }
        }
     };
   
  // from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
  function escapeRegExp(string){
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // This is from underscore. It's a <<shallow>> object merge.
  function extend(obj) {
    each(Array.prototype.slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          obj[prop] = source[prop];
        }
      }
    });
    return obj;
  }

  function kvarg(which){
    var ret = {};

    if(which.length == 2) {
      ret[which[0]] = which[1];
      return ret;
    }

    if(which.length == 1) {
      return which[0];
    }
  }

  function hash(array) {
    var ret = {};

    each(array, function(index) {
      ret[index] = true;
    });

    return ret;
  }

  function trace(obj, cb) {
    obj.__trace__ = {};

    each(obj, function(key, value) {
      if(_.isFun(value)) {
        obj.__trace__[key] = value;
        obj[key] = function() {
          console.log([key + ":" ].concat(_slice(arguments)));
          if(cb) { cb.apply(this, arguments); }
          return obj.__trace__[key].apply(this, arguments);
        }
      }
    });
  }

  function copy(obj) {
    // we need to call slice for array-like objects, such as the dom
    return _.isObj(obj) ? (
      'length' in obj ? _slice(obj) : values(obj)
    ) : obj;
  }

  // These function accept index lists.
  function setdiff(larger, subset) {
    var ret = [];

    stain(subset);

    for(var ix = 0, len = larger.length; ix < len; ix++) {
      if (isStained(larger[ix])) { 
        unstain(larger[ix]);
        continue;
      } 
      ret.push(larger[ix]);
    }

    return ret;
  }

  // 
  // "Staining" is my own crackpot algorithm of comparing
  // two unsorted lists of pointers that reference shared
  // objects. We go through list one, affixing a unique
  // constant value to each of the members. Then we go
  // through list two and see if the value is there.
  //
  // This has to be done rather atomically as the value
  // can easily be replaced by something else.  It's an
  // N + M cost...
  //
  function stain(list) {
    _stainID++;

    each(list, function(ix, el) {
      el[_stainKey] = _stainID;
    });
  }

  function unstain(obj) {
    delete obj[_stainKey];
  }

  function isStained(obj) {
    return obj[_stainKey] == _stainID;
  }

  // The first parameter, if exists, is assumed to be the value in the database,
  // which has a content of arrays, to search.
  // The second parameter is the index to search
  function has(param1, param2) {
    var 
      len = arguments.length,
      compare = len == 1 ? param1 : param2,
      callback,
      obj = {};

    if(_.isArr(compare)) {
      var len = compare.length;

      // This becomes O(N * M)
      callback = function(key) {
        for(var ix = 0; ix < len; ix++) {
          if (indexOf(key, compare[ix]) > -1) {
            return true;
          }
        }
        return false;
      }
    } else {
      // This is O(N)
      callback = function(key) {
        return indexOf(key, compare) > -1;
      }
    }

    if(len == 2) {
      obj = {};
      obj[param1] = callback;
      return obj;
    } else {
      return callback;
    }
  }

  function find() {
    var 
      filterList = _slice(arguments),
      filter,
      filterIx,

      which,
      val,

      filterComp,
      // The dataset to compare against
      set = _.isBrk(this) ? this : filterList.shift();

    if( filterList.length == 2 && _.isStr( filterList[0] )) {
      // This permits find(key, value)
      which = {};
      which[filterList[0]] = filterList[1];
      filterList = [which];
    } 

    for(filterIx = 0; filterIx < filterList.length; filterIx++) {
      filter = filterList[filterIx];

      // If we are looking at an array, then this acts as an OR, which means
      // that we just recursively do this.
      if(_.isArr(filter)) {

        // this style is 
        // ([key1, key2, key3], rhs)
        // which means
        //  key1 == rhs || key2 == rhs || key3 == rhs ... 
        if(_.isScalar(filter[0]) && filterList.length == 2) {

          var 
            filterkey_list = filter, 
            // remove it from the list so it doesn't get
            // a further comprehension
            filterkey_compare = filterList.pop();

          filterComp = [function(row) {
            for(var ix = 0; ix < filterkey_list.length; ix++) {
              if(equal(row[filterkey_list[ix]], filterkey_compare)) {
                return true;
              }
            }
          }]
        } else {
          filterComp = map(filter, expression);
        }
        
        set = bracket.prototype.filter.call(set, function(row) {
          // this satisfies the base case.
          var ret = true;
          for (var ix = 0; ix < filterComp.length; ix++) {
            if(filterComp[ix](row)) {
              return true;
            }
            ret = false;
          }
          return ret;
        });
      } else if(_.isFun(filter)) {
        set = set.filter(filter);
      } else {
        each(filter, function(key, value) {
          // this permits mongo-like invocation
          if( _.isObj(value)) {
            var 
              _key = keys(value)[0],
              _fn = _key.slice(1);

            // see if the routine asked for exists
            if(_fn in bracket) {
              value = bracket[_fn](value[_key]);
            } else {
              throw new Error(_fn + " is an unknown function");
            }
          } else if( _.isArr(value)) {
            // a convenience isin short-hand.
            value = isin(value);
          }

          if(_.isFun(value)) {
            filterComp = function(which) {
              // Check for existence
              if( key in which ) {
                val = which[key];

                // Permit mutator events
                if( _.isFun(val) ) { val = val(); }

                return value(val, which);
              }
            }
          } else {
            filterComp = function(which) {
              val = which[key];

              if( _.isFun(val) ) { val = val(); }

              // Check for existence
              return (key in which && val === value );
            };
          }
          set = bracket.prototype.filter.call(set, filterComp);
        });
      }
    }

    return set;
  }

  //
  // missing
  //
  // Missing is to get records that have keys not defined
  //
  function missing(arg) {
    var fieldList = hash(arg);

    return function(record) {
      for(var field in fieldList) {
        if(field in record) {
          return false;
        }
      }
      return true;
    };
  }

  // 
  // isin
  //
  // This is like the SQL "in" operator, which is a reserved JS word.  You can invoke it either
  // with a static array or a callback
  //
  var isin = function (param1, param2) {
    var 
      callback,
      len = arguments.length,
      compare = len == 1 ? param1 : (param2 || []),
      dynamicList = [],
      staticList = [],
      obj = {};

    // If the second argument is an array then we assume that we are looking
    // to see if the value in the database is part of the user supplied funciton
    if(!_.isArr(compare)) {
      throw new TypeError("isin's argument is wrong. ", compare);
    }
    if(compare.length){
      each(compare, function(what) {
        if(_.isFun(what)) {
          dynamicList.push(what);
        } else {
          staticList.push(what);
        }
      });

      callback = function(x) { 
        var res = indexOf(staticList, x) > -1; 
        for(var ix = 0; ix < dynamicList.length; ix++) {
          if(res) { break; }
          res = dynamicList[ix](x);
        }
        return res;
      };
    } else if (_.isFun(compare)) {
      callback = function(x) { return indexOf(compare(), x) > -1; };
    } else {
      callback = compare;
    }

    if(len == 2) {
      obj = {};
      obj[param1] = callback;
      return obj;
    } else {
      return callback;
    }
  }

  function equal(lhs, rhs) {
    return (lhs === rhs) || (
        !_.isUndef(lhs) && (
          (lhs.join && rhs.join) &&
          (lhs.sort().toString() === rhs.sort().toString())
        ) || 
        (JSON.stringify(lhs) === JSON.stringify(rhs)
      ));
  }

  function isArray(what) {
    var asString = what.sort().join('');
    return function(param) {
      return param.sort().join('') === asString;
    }
  }

  function like(param1, param2) {
    var 
      compare,
      len = arguments.length,
      query,
      queryRE,
      obj = {};

    if(len == 1) {
      query = param1;
    } else if(len == 2){
      query = param2;
    } 

    query = query.toString();

    compare = function(x) { 
      if(x === null) {
        return false;
      }

      try {
        queryRE = new RegExp(query, 'img');
      } catch (ex) {
        queryRE = new RegExp(escapeRegExp(query), 'img');
      }

      return x.toString().search(queryRE) > -1;
    }

    if(len == 2) {
      obj = {};
      obj[param1] = compare;
      return obj;
    } else {
      return compare;
    }
  }

  function update(arg0, arg1) {
    var 
      key, 
      filter = this;

    // This permits update(key, value) on a chained find
    if( arg1 !== _u ) {

      // Store the key string
      key = arg0;

      // The constraint is actually the new value to be
      // assigned.
      arg0 = {};
      arg0[key] = arg1; 
    }

    if(_.isFun(arg0)) {
      // The JS each has a first arg as a record number.
      // I think this is a pretty useless call-style since
      // in our case it's always incrementing.
      each(filter, function(ix, record) {
        arg0(record);
      });
    } else {
      // {a: blah, b: blah}
      each(arg0, function(key, value) {
        // {a: function(){ return }}
        if(_.isFun( value )) {
          // take each item from the filter (filtered results)
          // and then apply the value function to it, storing
          // back the results
          each(filter, function(ix, which) { 
            if(_.isFun(which[key])) {

              which[key]( value(which) );
            } else {
              which[key] = value(which); 
            }
          });
        } else {
          // otherwise, assign the static 
          each(filter, function(ix, which) { 
            if(_.isFun(which[key])) {
              which[key]( value );
            } else {
              which[key] = value; 
            }
          });
        }
      });
    }

    return filter;
  }

  function not( lambda ) {
    return function() {
      return !lambda.apply(this, arguments);
    }
  }

  function fwrap(str) {
    return "try{return " + str + "}catch(e){}";
  }

  var expression = function(arg0, arg1) {
    var ret, expr;

    if(_.isStr( arg0 )) {
      expr = arg0;

      //
      // There are TWO types of lambda function here (I'm not using the
      // term 'closure' because that means something else)
      //
      // We can have one that is sensitive to a specific record member and 
      // one that is local to a record and not a specific member.  
      //
      // As it turns out, we can derive the kind of function intended simply
      // because they won't ever syntactically both be valid in real use cases.
      //
      // I mean sure, the empty string, space, semicolon etc is valid for both, 
      // alright sure, thanks smarty pants.  But is that what you are using? really?
      //
      // No? ok, me either. This seems practical then.
      //
      // The invocation wrapping will also make this work magically, with proper
      // expressive usage.
      //

      if(arguments.length == 2 && _.isStr(arg1)) {
        expr = arg1;
        ret = new Function("x,rec", fwrap("x." + arg0 + expr));

        // if not, fall back on it 
        ret[arg0] = new Function("x,rec", fwrap("x " + expr));
      } else {
        try {
          ret = new Function("x,rec", fwrap("x " + expr));
        } catch(ex) {}

        if(!ret) {
          try {
            ret = new Function("rec", fwrap(arg0));
          } catch(ex) {}
        }
      }

      return ret;
      // make a truth condition from this.
      // We're getting things like {a: b} etc
    } else if (_.isObj( arg0 )) {

      var cList = [];
      for(var key in arg0) {
        cList.push("equal(rec['" + key + "']," + (_.isScalar(arg0[key]) ? arg0[key] : "arg0[" + key +"]")  +")");
      };

      return eval('(function(rec){ return ' + cList.join('&&') + '})');
    }
  }

  function eachRun(callback, arg1) {
    var 
      context = 0,
      ret = [],
      filter;

    if(arguments.length == 2) {
      filter = callback;
      callback = arg1;
    } else {
      filter = this;
    }

    if(_.isArr(callback) && callback.length == 2) {
      context = callback[0];
      callback = callback[1];
    }

    if(_.isBrk(filter) || _.isArr(filter)) {
      ret = map(_slice(filter), callback);
    } else {
      ret = {};

      for(var key in filter) {
        if(!_.isFun(filter[key])) {
          ret[key] = callback.call(context, filter[key]);
        }
      }
    } 

    return ret;
  }

  // see http://stackoverflow.com/questions/1606797/use-of-apply-with-new-operator-is-this-possible
  function construct(constructor, args) {
    function F() {
      return constructor.apply(this, args);
    }
    F.prototype = constructor.prototype;
    return new F();
  }

  // --- START OF AN INSTANCE ----
  //
  // This is the Start of a bracket instance.
  // All the instance local functions
  // and variables ought to go here. Things
  // that would have been considered "static"
  // in a language such as Java or C++ should
  // go above!!!!
  //
  var bracket = function(arg0, arg1){
    if (arguments.length == 1 && _.isStr(arg0)) { 
      return expression.apply(this, arguments);
    }

    if(!_.isBrk(this)) {
      return construct(bracket, _slice(arguments));
    }

    var mthis = this;

    each({
      _dbIx: _dbIx++,
      chained: false,
      syncList: [],
      length: 0,
      syncLock: false,
      _template: false,
      constraints: {addIf:[], unique: false},

      //
      // This is our atomic counter that
      // gets moved forward for different
      // operations
      //
      _ix: {ins:0, del:0},

      // globals with respect to this self.
      _g: {}
    }, function(key, value) {
      Object.defineProperty(mthis, key, {
        value: value,
        writable: true,
        enumerable: false
      });
    });

    Object.defineProperty(this, 'first', {
      get: function(){
        return this[0];
      }
    });

    // The ability to import a database from somewhere
    if (arguments.length == 1) {
      if(_.isArr(arg0)) { this.insert(arg0) }
      else if(_.isFun(arg0)) { this.insert(arg0()) }
      else if(_.isObj(arg0)) { this.insert(arg0) }
    } else if(arguments.length > 1) {
      this.insert(_slice(arguments));
    }

    // Register this instance.
    bracket.all.push(this);
  }

  bracket.prototype = Object.create(Array.prototype);
  bracket.constructor = bracket;

  each({

    transaction_start: function() {
      this.syncLock = true;
    },
    transaction_end: function(){
      // Have to turn the syncLock off prior to attempting it.
      this.syncLock = false;
      this.sync();
    },

    template_create: function(opt) { this._template = opt; },
    template_update: function(opt) { extend(this._template || {}, opt); },
    template_get: function() { return this._template },
    template_destroy: function() { this._template = false },

    reverse: function() {
      // We start with a new instance of our own object, myArray
      var ret = new bracket();
      ret.splice.apply(ret, [0, 0].concat(_slice(this).reverse()));
      return ret;
    },

    // See the interesting 1-person discussion with myself here:
    // http://stackoverflow.com/questions/30741140/can-javascript-do-polymorphic-duck-typing-for-arrays-see-details
    concat: function() {
      // We start with a new instance of our own object, myArray
      var ret = new bracket();

      // utilize the in-place `splice` to keep the type as `myArray`
      ret.splice.apply(

        // contextualize it for our own object
        ret, 
        Array.prototype.concat.apply( 
          // call it with the start and end of our empty object
          [0, 0],

          // with our object as an array
          _slice(this).concat(

            // added to the arguments, as an array
            arrify(arguments) 
          )
        ) 
      );

      // since splice returns the stuff that was removed, we
      // need to have an additional line here.
      return ret;
    },

    //
    // This isn't a true schema derivation ... it's a spot check
    // over the data-set to try to show a general schema ... since
    // this is essentially a schema-less document store there could
    // be things missing.
    //
    schema: function() {
      // rand() is slow on android (2013-01) and the entropy 
      // can have some issues so we don't try doing that.
      // The interwebs claims that every 10th sampling is a good
      // way to roll, so let's do that.
      //
      // Js perf says a trivial double for is the way to roll
      // with a very slight edge for caching ... although this
      // makes no sense whatsoever.
      var 
        agg = {}, 
        len = this.length, 
        skip = Math.ceil(Math.min(10, len / 3)),
        entry;

      for(var i = 0; i < len; i += skip ) {
        entry = this[i];

        for(var key in entry) {
          agg[key] = _u;
        }
      }

      return keys(agg);
    },

    // 
    // This is to constrain the database.  Currently you can enforce a unique
    // key value through something like `db.constrain('unique', 'somekey')`.
    // You should probably run this early, as unlike in RbracketMSs, it doesn't do
    // a historical check nor does it create a optimized hash to index by
    // this key ... it just does a lookup every time as of now.
    //
    constrain: function() { 
      extend(this.constraints, kvarg(arguments)); 
    },
      
    // Adds if and only if a function matches a constraint
    addIf: function( lambda ) {
      if(lambda) {
        this.constraints.addIf.push(lambda);
      }
      return this.constraints.addIf;
    },

    // beforeAdd allows you to mutate data prior to insertion.
    // It's really an addIf that returns true
    beforeAdd: function( lambda ) {
      return this.addIf(
        lambda ? 
            function() { lambda.apply(0, arguments); return true; } 
          : false
        )
    },

    unset: function(key) {
      if(_.isArr(key)) {
        var mthis = this, mfunc = arguments.callee;
        return each(key, function(){
          return mfunc.apply(mthis, arguments);
        });
      } else {
        each(this, function(ix, item) {
          if(key in item) {
            delete item[key];
          }
        });
        this.sync();
        return this;
      }
    },

    each: eachRun,
    map: eachRun,
    not: not,

    // This is a shorthand to find for when you are only expecting one result.
    // A boolean false is returned if nothing is found
    findFirst: function(){
      var realFilter = bracket.prototype.filter, res = false;
      bracket.prototype.filter = bracket.prototype.filterThrow;
      try { 
        this.find.apply(this, arguments);
      } catch(ex) {
        res = ex;
      }
      bracket.prototype.filter = realFilter;
      return res;
    },

    has: has,

    // hasKey is to get records that have keys defined
    hasKey: function() {
      var inner = this.find(missing(_slice(arguments)));

      return this.invert(inner, this);
    },

    isin: isin,
    like: like,
    invertArray: function(list, second) { 
      return setdiff(second || this.chained || this, list || this); 
    },
    invert: function(list, second) { 
      return this._chain(this.invertArray(list, second));
    },

    // Missing is to get records that have keys not defined
    missing: function() { 
      var base = missing(_slice(arguments));
      return this.chained ? this.find(base) : base;
    },

    // The callbacks in this list are called
    // every time the database changes with
    // the raw value of the database.
    //
    // Note that this is different from the internal
    // definition of the sync function, which does the
    // actual synchronization
    sync: function(callback) { 
      var mthis = this;
      if(callback) {
        this.syncList.push(callback);
      } else { 
        if(!this.syncLock) {
          this.syncLock = true;
          each(this.syncList, function(which) { 
            which.call(mthis, mthis); 
          });
          this._bubble('sync');
          this.syncLock = false;
        }
      }
      return this;
    },

    //
    // update
    //
    // Update allows you to set newvalue to all
    // parameters matching constraint where constraint
    // is either a set of K/V pairs or a result
    // of find so that you can do something like
    //
    // Update also can take a callback.
    //
    //   var result = db.find(constraint);
    //   result.update({a: b});
    //
    update: function() {
      var list = update.apply(this, arguments);
      this.sync();
      return list;
    },

    //
    // group
    //
    // This is like SQLs groupby function. It will take results from any other function and then
    // return them as a hash where the keys are the field values and the results are an array
    // of the rows that match that value.
    //
    group: function(field) {
      var groupMap = {}, mthis = this;

      each(this, function(ix, which) {
        if(field in which) {
          each(which[field], function(what) {
            // if it's an array, then we do each one.

            if(! (what in groupMap) ) {
              groupMap[what] = mthis._chain([]);
            }

            groupMap[what].push(which);
          });
        }
      });
      
      return groupMap;
    },

    //
    // keyBy
    //
    // This is like group above but it just maps as a K/V tuple, with 
    // the duplication policy of the first match being preferred.
    //
    keyBy: function(field) {
      var groupResult = this.group.apply(this, arguments);

      each(groupResult, function(key, value) {
        groupResult[key] = value[0];
      });

      return groupResult;
    },

    //
    // indexBy is just a sort without a chaining of the args
    //
    indexBy: function () {
      // set the order output to the raw
      this.splice.apply(
        this, 
        [0, this.length].concat(
          _slice(
            this.order.apply(this, arguments)
          )
        )
      );
    },

    _bubble: function(cb, args) {
      if(this.chained) {
        return this.chained[cb].apply(this.chained, args || []);
      }
      return _stainKey;
    },

    _chain: function(list) {
      var ret = (new bracket()).concat(list);
      ret.chained = this.chained || this;
      return ret;
    },

    //
    // sort
    //
    // This is like SQLs orderby function.  If you pass it just a field, then
    // the results are returned in ascending order (x - y).  
    //
    // You can also supply a second parameter of a case insensitive "asc" and "desc" like in SQL.
    //
    order: function (arg0, arg1) {
      var 
        key, 
        fnSort,
        len = arguments.length,
        order;

      if(_.isFun(arg0)) {
        fnSort = arg0;
      } else if(_.isStr(arg0)) {
        key = arg0;

        if(len == 1) {
          order = 'x-y';
        } else if(len == 2) {

          if(_.isStr(arg1)) {
            order = {
              'asc': 'x-y',
              'desc': 'y-x'
            }[arg1.toLowerCase()];
          } else {
            order = arg1;
          }
        }

        if(_.isStr(order)) {
          order = new Function('x,y', fwrap(order));
        }

        fnSort = eval('(function(a,b){return order(a.' + key + ', b.' + key + ')})');
      }
      return this._chain(Array.prototype.sort.call(this,fnSort));
    },

    where: function() {
      var args = _slice(arguments);

      // Addresses test 23 (Finding: Find all elements cascaded, 3 times)
      if(!_.isBrk(this)) {
        args = [this].concat(args);
      } 

      return this._chain( find.apply(this, args) );
    },

    //
    // lazyView
    //
    // lazyViews are a variation of views that have to be explicitly rebuilt
    // on demand with ()
    //
    lazyView: function(field, type) {
      // keep track
      var 
        mthis = this,
        myix = {del: this._ix.del, ins: this._ix.ins},
        keyer;
      
      if(field.search(/[()]/) == -1) {
        if(field.charAt(0) !== '[' || field.charAt(0) !== '.') {
          field = '.' + field;
        }

        keyer = eval( "(function(r,ref){try{ref[rX] = update[rX] = r;}catch(x){}})".replace(/X/g, field));
      } else {
        keyer = eval( "(function(r,ref){try{with(r){ var val = X };ref[val] = update[val] = r;}catch(x){}})".replace(/X/g, field));
      }

      function update(whence) {
        if(whence) {
          // if we only care about updating our views
          // on a new delete, then we check our atomic
          if(whence == 'del' && myix.del == mthis._ix.del) {
            return;
          } else if(whence == 'ins' && myix.ins == mthis._ix.ins) {
            return;
          }
        }
        myix = {del: mthis._ix.del, ins: mthis._ix.ins};

        var ref = {};

        each(mthis, function(ix, row) {
          keyer(row, ref);
        });

        for(var key in update) {
          if( ! (key in ref) ) {
            delete update[key];
          }
        }
      }

      update();
      return update;
    },

    //
    // view 
    //
    // Views are an expensive synchronization macro that return 
    // an object that can be indexed in order to get into the data.
    //
    view: function(field, type) {
      var fn = this.lazyView(field, type);
      this.sync(fn);
      return fn;
    },

    //
    // select
    //
    // This will extract the values of a particular key from the filtered list
    // and then return it as an array or an array of arrays, depending on
    // which is relevant for the query.
    //
    // You can also do db.select(' * ') to retrieve all fields, although the 
    // key values of these fields aren't currently being returned.
    //
    select: function(field) {
      var 
        filter = this,
        fieldCount,
        resultList = {};

      if(arguments.length > 1) {
        field = _slice(arguments);
      } else if (_.isStr(field)) {
        field = [field];
      }

      fieldCount = field.length;
      
      each(field, function(column, iy) {
        if(column == '*') {
          resultList = map(filter, values);
        } else {
          for(var ix = 0, len = filter.length; ix < len; ix++) {
            row = filter[ix];

            if(column in row){
              if(fieldCount > 1) {
                if(!resultList[ix]) {
                  resultList[ix] = [];
                }
                resultList[ix][iy] = row[column];
              } else {
                resultList[ix] = row[column];
              }
            }
          }
        }
      });
      
      return this._chain(values(resultList));
    },

    // 
    // insert
    //
    // This is to insert data into the database.  You can either insert
    // data as a list of arguments, as an array, or as a single object.
    //
    insert: function(param) {
      var 
        mthis = this.chained || this,
        ix,
        unique = mthis.constraints.unique,
        existing = [],
        toInsert = [],
        insList = [];

      //
      // Parse the args put in.  
      // 
      // If it's a comma seperated list then make the 
      // list to insert all the args
      if(arguments.length > 1) {
        toInsert = _slice(arguments);

        // if it was an array, then just assign it.
      } else if (_.isArr(param)) {
        toInsert = param;

        // otherwise it's one argument and 
        // we just insert that alone.
      } else if (_.isBrk(param)) {
        toInsert = _slice(param);
      } else {
        toInsert = [param];
      } 

      each(toInsert, function(which) {
        // We first check to make sure we *should* be adding this.
        var doAdd = true, data;

        // If the unique field has been set then we do
        // a hash search through the constraints to 
        // see if it's there.
        if(unique && (unique in which)) {

          // If the user had opted for a certain field to be unique,
          // then we find all the matches to that field and create
          // a block list from them.
          var 
            key = 'c-' + unique, 
            map_;

          // We create a lazyView 
          if(!mthis._g[key]) {
            mthis._g[key] = mthis.lazyView(unique);
          } else {
            // Only update if a delete has happened
            mthis._g[key]('del');
          }

          map_ = mthis._g[key];

          // This would mean that the candidate to be inserted
          // should be rejected because it doesn't satisfy the
          // unique constraint established.
          if(which[unique] in map_){

            // Create a reference list so we know what was existing
            existing.push(map_[which[unique]]);

            // put on the existing value
            insList.push(map_[which[unique]]);

            // Toggle our doAdd over to false.
            doAdd = false;
          } else {
            // Otherwise we assume it will be added and
            // put it in our map for future reference.
            map_[which[unique]] = which;
          }
        }

        each(mthis.constraints.addIf, function(test) {
          // Make sure that our candidate passes all tests.
          doAdd &= test(which);
        });

        if(!doAdd) {
          return;
        } 
        // if we got here then we can update 
        // our dynamic counter.
        mthis._ix.ins++;

        // If we get here, then the data is going in.
        ix = mthis.length;

        // insert from a template if available
        if(mthis._template) {
          var instance = {};
          
          // create a template instance that's capable
          // of holding evaluations
          each(mthis._template, function(key, value) {
            if(_.isFun(value)) {
              instance[ key ] = value();
            } else {
              instance[ key ] = value;
            }
          });

          // map the values to be inserted upon
          // the instance of this template
          which = extend(instance, which);
        }

        mthis.push(which);

        insList.push(which);
      });

      mthis.sync();
     
      return mthis._chain(insList);
    },

    // 
    // The quickest way to do an insert. 
    // This checks for absolutely nothing.
    //
    flash: function(list) {
      this.splice.apply(this, [0,0].concat(list));
    },

    filterThrow: function(fun/*, thisArg*/) {
      var t = this;
      var len = t.length;

      var res = [];
      var thisArg = arguments.length >= 2 ? arguments[1] : void 0;
      for (var i = 0; i < len; i++) {
        if (i in t) {
          var val = t[i];

          if (fun.call(thisArg, val, i, t)) {
            throw val;
          }
        }
      }

      return res;
    },

    filter: [].filter ? Array.prototype.filter :
      function(fun/*, thisArg*/) {
        'use strict';

        var t = this, val;
        var len = t.length;

        var res = [];
        var thisArg = arguments.length >= 2 ? arguments[1] : void 0;
        for (var i = 0; i < len; i++) {
          if (i in t) {
            val = t[i];

            if (fun.call(thisArg, val, i, t)) {
              res.push(val);
            }
          }
        }

        return res;
      },

    //
    // remove
    // 
    // This will remove the entries from the database but also return them if
    // you want to manipulate them.  You can invoke this with a constraint.
    //
    remove: function(arg0, arg1) {
      var 
        isDirty = false,
        end, start,
        masterList = this.chained || this,
        toRemove = this,
        save = [];

      if(_.isArr(arg0)) { 
        toRemove = arg0; 
      } 
      else if(arguments.length > 0){ 
        // This is the portion we will be saving via inverse
        save = this.find.apply(this, arguments);

        if(save.length) {
          
          this.splice.apply(this, [0, this.length].concat(this.invertArray(save)));
          this._ix.del++;
          this.sync();
        }
        return save.reverse();
      } 

      stain(toRemove);

      for(var ix = masterList.length - 1, end = masterList.length; ix >= 0; ix--) {
        if (isStained(masterList[ix])) { 
          unstain(masterList[ix]);
          save.push(masterList[ix]);
          continue;
        }
        if(end - (ix + 1)) {
          start = ix + 1;
          masterList.splice(start, end - start);
          isDirty = true;
        }
        end = ix;
      }

      start = ix + 1;
      if(end - start) {
        masterList.splice(start, end - start);
        isDirty = true;
      }

      if(isDirty) {
        // If we've spliced, then we sync and update our
        // atomic delete counter
        masterList._ix.del++;
        masterList.sync();
      }
      return this._chain(save.reverse());
    },
  }, function(key, value) {
    Object.defineProperty(bracket.prototype, key, {
      value: value,
      writable: true
    });
  });

  each({
    sort: bracket.prototype.order,
    orderBy: bracket.prototype.sort,
    find: bracket.prototype.where
  }, function(key, value) {
    Object.defineProperty(bracket.prototype, key, {
      value: value
    });
  });

  return extend(bracket, {
    all: [],
    find: find,
    diff: setdiff,
    each: eachRun,
    not: not,
    exec: expression,
    like: like,
    trace: trace,
    values: values,
    isin: isin,
    isArray: isArray,

    // like expr but for local functions
    local: function(){
      return '(function(){ return ' + 
        bracket.apply(this, arguments).toString() + 
      ';})()';
    },

    // expensive basic full depth copying.
    copy: function(data) {
      var ret = (map(data, function(what) {
        return copy(what);
      }));
      ret.length = data.length;
      return _slice(ret);
    },

    objectify: function(keyList, values) {
      var obj = [];

      each(values, function(row) {
        var objRow = {};
        each(keyList, function(key, index) {
          objRow[key] = row[index];
        });

        obj.push(objRow);

      });

      return obj; 
    },

    // This does a traditional left-reduction on a list
    // as popular in list comprehension suites common in 
    // functional programming.
    reduceLeft: function(memo, callback) {
      var lambda = _.isStr(callback) ? new Function("y,x", fwrap("y " + callback)) : callback;

      return function(list) {
        var reduced = memo;

        for(var ix = 0, len = list.length; ix < len; ix++) {
          if(list[ix]) {
            reduced = lambda(reduced, list[ix]);
          }
        }

        return reduced;
      }
    },

    // This does a traditional right-reduction on a list
    // as popular in list comprehension suites common in 
    // functional programming.
    //
    reduceRight: function(memo, callback) {
      var callback = bracket.reduceLeft(memo, callback);

      return function(list) {
        return callback(list.reverse());
      }
    }
  });

})();
