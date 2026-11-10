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

  // 16. BigInt safe fallback for WebViews < Chrome 67
  if (typeof root.BigInt !== 'function') {
    root.BigInt = function (val) {
      if (typeof val === 'number') return Math.trunc(val);
      if (typeof val === 'string') {
        var parsed = Number(val);
        return isNaN(parsed) ? 0 : Math.trunc(parsed);
      }
      return val ? 1 : 0;
    };
  }

  // 17. RegExp lookbehind safe fallback for WebViews < Chrome 62
  // 防止部分模块构造含 (?<=...) 或 (?<!...) 的正则时在老内核抛出 SyntaxError 导致整包崩溃
  try {
    new RegExp('(?<=a)b');
  } catch (e) {
    var NativeRegExp = root.RegExp;
    var PatchedRegExp = function (pattern, flags) {
      if (typeof pattern === 'string' && /\(\?<[=!]/.test(pattern)) {
        var safePattern = pattern.replace(/\(\?<[=!][^)]*\)/g, '');
        return new NativeRegExp(safePattern, flags);
      }
      return flags !== undefined ? new NativeRegExp(pattern, flags) : new NativeRegExp(pattern);
    };
    PatchedRegExp.prototype = NativeRegExp.prototype;
    try {
      Object.setPrototypeOf(PatchedRegExp, NativeRegExp);
    } catch (_) {}
    root.RegExp = PatchedRegExp;
  }

  // 18. IntersectionObserver safe fallback if absent on older WebViews
  if (typeof root.IntersectionObserver === 'undefined') {
    root.IntersectionObserver = function (callback) {
      return {
        observe: function (target) {
          setTimeout(function () {
            try {
              callback([{ isIntersecting: true, intersectionRatio: 1, target: target }], this);
            } catch (_) {}
          }, 16);
        },
        unobserve: function () {},
        disconnect: function () {},
        takeRecords: function () { return []; }
      };
    };
  }

  // 19. MatchMedia addEventListener / removeEventListener polyfill (Chrome < 70 only had addListener)
  if (typeof root.matchMedia === 'function') {
    var origMatchMedia = root.matchMedia.bind(root);
    root.matchMedia = function (query) {
      var mql = origMatchMedia(query);
      if (mql && !mql.addEventListener && mql.addListener) {
        mql.addEventListener = function (type, listener) {
          if (type === 'change') mql.addListener(listener);
        };
        mql.removeEventListener = function (type, listener) {
          if (type === 'change') mql.removeListener(listener);
        };
      }
      return mql;
    };
  }

  // 20. Android APK / TV WebView 环境自动卸载残留 Service Worker，防止首启/升级时被 workbox 预缓存风暴阻塞
  try {
    var ua = (root.navigator && root.navigator.userAgent) || '';
    var isAndroidApk = Boolean(
      root.Capacitor ||
      root.FoliaTvHardware ||
      (root.location && root.location.hostname === 'localhost' && (/FoliaTV/i.test(ua) || /;\s*wv\)/i.test(ua)))
    );
    if (isAndroidApk && root.navigator && root.navigator.serviceWorker && typeof root.navigator.serviceWorker.getRegistrations === 'function') {
      root.navigator.serviceWorker.getRegistrations().then(function (regs) {
        for (var i = 0; i < regs.length; i++) {
          try { regs[i].unregister(); } catch (_) {}
        }
      }).catch(function () {});
    }
  } catch (_) {}

  // 21. Intl.Segmenter Polyfill (Chrome 87+)
  // 针对 TCL Q10K / Q9K、海信、创维酷开等内置较低版本 Chromium WebView (Chrome < 87) 的智能电视与盒子，
  // 补齐完整的 Intl.Segmenter（支持 grapheme 字素与 word 单词粒度分词、可迭代 Segments、isWordLike 及 .containing(index)），
  // 彻底根除 Uncaught TypeError: Intl.Segmenter is not a constructor 导致的启动受阻与白屏！
  if (!root.Intl) {
    root.Intl = {};
  }
  if (typeof root.Intl.Segmenter !== 'function') {
    function Segments(input, granularity) {
      this._input = String(input != null ? input : '');
      this._granularity = granularity || 'grapheme';
      this._segments = [];
      this._compute();
    }

    Segments.prototype._compute = function () {
      var text = this._input;
      var granularity = this._granularity;
      var segments = [];
      if (!text) {
        this._segments = segments;
        return;
      }

      if (granularity === 'word') {
        var wordRe = null;
        try {
          // 优先尝试标准 Unicode 字符类（支持各语种文字匹配）
          wordRe = new RegExp('[\\p{L}\\p{M}\\p{N}]+|[^\\p{L}\\p{M}\\p{N}\\s]+|\\s+', 'gu');
        } catch (_) {
          // 在极老内核上降级使用通用中英日韩正则
          wordRe = /[a-zA-Z0-9_\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]+|[^\w\s\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]+|\s+/g;
        }

        var match;
        while ((match = wordRe.exec(text)) !== null) {
          var seg = match[0];
          var idx = match.index;
          var isWordLike = false;
          try {
            isWordLike = /[\p{L}\p{M}\p{N}]/u.test(seg);
          } catch (_) {
            isWordLike = /[a-zA-Z0-9_\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(seg);
          }
          segments.push({
            segment: seg,
            index: idx,
            input: text,
            isWordLike: isWordLike
          });
        }
      } else {
        // 'grapheme'（字素）与 'sentence' 粒度
        // Array.from(text) 能正确按 Unicode 码点切分 Emoji 与代理对
        var codePoints = Array.from(text);
        var offset = 0;
        for (var i = 0; i < codePoints.length; i++) {
          var ch = codePoints[i];
          segments.push({
            segment: ch,
            index: offset,
            input: text,
            isWordLike: false
          });
          offset += ch.length;
        }
      }
      this._segments = segments;
    };

    Segments.prototype[Symbol.iterator] = function () {
      var segments = this._segments;
      var index = 0;
      return {
        next: function () {
          if (index < segments.length) {
            return { value: segments[index++], done: false };
          }
          return { done: true, value: undefined };
        }
      };
    };

    Segments.prototype.containing = function (index) {
      var idx = Math.max(0, Math.min(this._input.length - 1, Number(index) || 0));
      for (var i = 0; i < this._segments.length; i++) {
        var seg = this._segments[i];
        if (seg.index <= idx && idx < seg.index + seg.segment.length) {
          return seg;
        }
      }
      return this._segments[this._segments.length - 1] || null;
    };

    function Segmenter(locales, options) {
      if (!(this instanceof Segmenter)) {
        throw new TypeError("Constructor Intl.Segmenter requires 'new'");
      }
      this.granularity = (options && options.granularity) || 'grapheme';
    }

    Segmenter.prototype.segment = function (input) {
      return new Segments(input, this.granularity);
    };

    root.Intl.Segmenter = Segmenter;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window);
