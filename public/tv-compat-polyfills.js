// public/tv-compat-polyfills.js
// 为低版本 Android TV / 电视盒子 WebView (Chrome 55 ~ 98) 提供关键运行时 Polyfill
(function (global) {
  'use strict';

  // 1. globalThis
  if (typeof globalThis === 'undefined') {
    if (typeof self !== 'undefined') {
      self.globalThis = self;
    } else if (typeof window !== 'undefined') {
      window.globalThis = window;
    } else if (typeof global !== 'undefined') {
      global.globalThis = global;
    }
  }

  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  // 2. Object.hasOwn (Chrome 93+)
  if (!Object.hasOwn) {
    Object.hasOwn = function (obj, prop) {
      if (obj == null) {
        throw new TypeError('Cannot convert undefined or null to object');
      }
      return Object.prototype.hasOwnProperty.call(Object(obj), prop);
    };
  }

  // 3. Object.fromEntries (Chrome 73+)
  if (!Object.fromEntries) {
    Object.fromEntries = function (iterable) {
      var obj = {};
      if (iterable == null) return obj;
      for (var entry of iterable) {
        if (entry && entry.length >= 2) {
          obj[entry[0]] = entry[1];
        }
      }
      return obj;
    };
  }

  // 4. Array.prototype.at (Chrome 92+)
  if (!Array.prototype.at) {
    Array.prototype.at = function (n) {
      n = Math.trunc(n) || 0;
      if (n < 0) n += this.length;
      if (n < 0 || n >= this.length) return undefined;
      return this[n];
    };
  }

  // 5. String.prototype.at (Chrome 92+)
  if (!String.prototype.at) {
    String.prototype.at = function (n) {
      n = Math.trunc(n) || 0;
      if (n < 0) n += this.length;
      if (n < 0 || n >= this.length) return undefined;
      return this.charAt(n);
    };
  }

  // 6. String.prototype.replaceAll (Chrome 85+)
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (searchValue, replaceValue) {
      if (searchValue instanceof RegExp) {
        if (!searchValue.global) {
          throw new TypeError('String.prototype.replaceAll called with a non-global RegExp argument');
        }
        return this.replace(searchValue, replaceValue);
      }
      return this.split(String(searchValue)).join(String(replaceValue));
    };
  }

  // 7. Array.prototype.flat / flatMap (Chrome 69+)
  if (!Array.prototype.flat) {
    Array.prototype.flat = function (depth) {
      var d = typeof depth === 'number' ? Math.floor(depth) : 1;
      if (d <= 0) return Array.prototype.slice.call(this);
      var flatten = function (arr, curDepth) {
        var res = [];
        for (var i = 0; i < arr.length; i++) {
          if (i in arr) {
            var val = arr[i];
            if (Array.isArray(val) && curDepth > 0) {
              res.push.apply(res, flatten(val, curDepth - 1));
            } else {
              res.push(val);
            }
          }
        }
        return res;
      };
      return flatten(this, d);
    };
  }

  if (!Array.prototype.flatMap) {
    Array.prototype.flatMap = function (callback, thisArg) {
      return this.map(callback, thisArg).flat(1);
    };
  }

  // 8. Promise.allSettled (Chrome 76+)
  if (!Promise.allSettled) {
    Promise.allSettled = function (promises) {
      return Promise.all(
        Array.from(promises).map(function (promise) {
          return Promise.resolve(promise).then(
            function (value) {
              return { status: 'fulfilled', value: value };
            },
            function (reason) {
              return { status: 'rejected', reason: reason };
            }
          );
        })
      );
    };
  }

  // 9. Promise.any (Chrome 85+)
  if (!Promise.any) {
    Promise.any = function (promises) {
      return new Promise(function (resolve, reject) {
        var arr = Array.from(promises);
        var errors = new Array(arr.length);
        var remaining = arr.length;
        if (remaining === 0) {
          reject(new (root.AggregateError || Error)(errors, 'All promises were rejected'));
          return;
        }
        arr.forEach(function (p, i) {
          Promise.resolve(p).then(
            resolve,
            function (err) {
              errors[i] = err;
              remaining--;
              if (remaining === 0) {
                reject(new (root.AggregateError || Error)(errors, 'All promises were rejected'));
              }
            }
          );
        });
      });
    };
  }

  // 10. queueMicrotask (Chrome 71+)
  if (typeof root.queueMicrotask !== 'function') {
    root.queueMicrotask = function (callback) {
      Promise.resolve().then(callback).catch(function (err) {
        setTimeout(function () { throw err; }, 0);
      });
    };
  }

  // 11. crypto.randomUUID (Chrome 92+)
  if (root.crypto && !root.crypto.randomUUID) {
    root.crypto.randomUUID = function () {
      return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, function (c) {
        return (c ^ (root.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16);
      });
    };
  }

  // 12. structuredClone (Chrome 98+)
  if (typeof root.structuredClone !== 'function') {
    root.structuredClone = function (obj) {
      if (obj === undefined) return undefined;
      try {
        return JSON.parse(JSON.stringify(obj));
      } catch (e) {
        // Fallback for simple clone
        return obj;
      }
    };
  }

  // 13. CSS.supports (Chrome 61+) safe fallback
  if (!root.CSS) {
    root.CSS = {};
  }
  if (!root.CSS.supports) {
    root.CSS.supports = function () {
      return false;
    };
  }

  // 14. scrollTo / scrollIntoView options smooth fallback for older Android WebViews
  if (typeof Element !== 'undefined' && Element.prototype) {
    var nativeScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg) {
      if (typeof arg === 'object' && arg !== null) {
        var block = arg.block || 'nearest';
        var alignToTop = block === 'start';
        nativeScrollIntoView.call(this, alignToTop);
      } else {
        nativeScrollIntoView.apply(this, arguments);
      }
    };
  }

  // 15. ResizeObserver safe fallback if absent on very old WebViews (Chrome 64+)
  if (typeof root.ResizeObserver === 'undefined') {
    root.ResizeObserver = function (callback) {
      var observed = [];
      var handle = null;
      var poll = function () {
        var entries = [];
        for (var i = 0; i < observed.length; i++) {
          var target = observed[i].target;
          var rect = target.getBoundingClientRect();
          if (rect.width !== observed[i].width || rect.height !== observed[i].height) {
            observed[i].width = rect.width;
            observed[i].height = rect.height;
            entries.push({
              target: target,
              contentRect: rect
            });
          }
        }
        if (entries.length > 0) {
          callback(entries, this);
        }
      };
      return {
        observe: function (target) {
          var rect = target.getBoundingClientRect();
          observed.push({ target: target, width: rect.width, height: rect.height });
          if (!handle) {
            handle = setInterval(poll, 250);
          }
        },
        unobserve: function (target) {
          observed = observed.filter(function (item) { return item.target !== target; });
          if (observed.length === 0 && handle) {
            clearInterval(handle);
            handle = null;
          }
        },
        disconnect: function () {
          observed = [];
          if (handle) {
            clearInterval(handle);
            handle = null;
          }
        }
      };
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window);
