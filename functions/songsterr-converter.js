// Convertitore Songsterr → alphaTab di songsterr-downloader (Ryan Roberts, MIT), compilato in un file solo con esbuild
// da https://github.com/Metaphysics0/songsterr-downloader (src/lib/server/services/converter). Licenza: LICENSE-songsterr-downloader.
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/songsterr-to-alphatab.converter.ts
var songsterr_to_alphatab_converter_exports = {};
__export(songsterr_to_alphatab_converter_exports, {
  SongsterrToAlphaTabConverter: () => SongsterrToAlphaTabConverter
});
module.exports = __toCommonJS(songsterr_to_alphatab_converter_exports);
var alphaTab2 = __toESM(require("@coderline/alphatab"));

// src/duration-mapper.ts
var alphaTab = __toESM(require("@coderline/alphatab"));
var baseDurations = [
  alphaTab.model.Duration.Whole,
  alphaTab.model.Duration.Half,
  alphaTab.model.Duration.Quarter,
  alphaTab.model.Duration.Eighth,
  alphaTab.model.Duration.Sixteenth,
  alphaTab.model.Duration.ThirtySecond,
  alphaTab.model.Duration.SixtyFourth
];
function mapSongsterrDuration(duration) {
  if (!duration) {
    return {
      duration: alphaTab.model.Duration.Quarter,
      dots: 0,
      isApproximate: true
    };
  }
  const [numerator, denominator] = duration;
  if (!numerator || !denominator) {
    return {
      duration: alphaTab.model.Duration.Quarter,
      dots: 0,
      isApproximate: true
    };
  }
  const targetValue = numerator / denominator;
  let bestDuration = alphaTab.model.Duration.Quarter;
  let bestDots = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidateDuration of baseDurations) {
    const baseValue = 1 / Number(candidateDuration);
    for (const dots of [0, 1, 2]) {
      const dottedValue = baseValue + (dots >= 1 ? baseValue / 2 : 0) + (dots >= 2 ? baseValue / 4 : 0);
      const delta = Math.abs(dottedValue - targetValue);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestDuration = candidateDuration;
        bestDots = dots;
      }
    }
  }
  return {
    duration: bestDuration,
    dots: bestDots,
    isApproximate: bestDelta > 1e-6
  };
}

// src/instrument-map.ts
function mapSongsterrInstrumentToPlayback(instrumentId) {
  if (instrumentId === 1024) {
    return {
      program: 0,
      isPercussion: true,
      primaryChannel: 9,
      secondaryChannel: 9
    };
  }
  const normalizedProgram = typeof instrumentId === "number" ? Math.min(Math.max(instrumentId, 0), 127) : 24;
  return {
    program: normalizedProgram,
    isPercussion: false
  };
}

// node_modules/fflate/esm/index.mjs
var import_module = require("module");
var require2 = (0, import_module.createRequire)("/");
var _a;
var Worker;
var isMarkedAsUntransferable;
try {
  _a = require2("worker_threads"), Worker = _a.Worker, isMarkedAsUntransferable = _a.isMarkedAsUntransferable;
} catch (e) {
}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i2 = 0; i2 < 31; ++i2) {
    b[i2] = start += 1 << eb[i2 - 1];
  }
  var r = new i32(b[30]);
  for (var i2 = 1; i2 < 30; ++i2) {
    for (var j = b[i2]; j < b[i2 + 1]; ++j) {
      r[j] = j - b[i2] << 5 | i2;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = (function(cd, mb, r) {
  var s = cd.length;
  var i2 = 0;
  var l = new u16(mb);
  for (; i2 < s; ++i2) {
    if (cd[i2])
      ++l[cd[i2] - 1];
  }
  var le = new u16(mb);
  for (i2 = 1; i2 < mb; ++i2) {
    le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        var sv = i2 << 4 | cd[i2];
        var r_1 = mb - cd[i2];
        var v = le[cd[i2] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i2 = 1; i2 < a.length; ++i2) {
    if (a[i2] > m)
      m = a[i2];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i2 = 0; i2 < hcLen; ++i2) {
          clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i2 = 0; i2 < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i2++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i2++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i2 = sym - 257, b = fleb[i2];
          add = bits(dat, pos, (1 << b) - 1) + fl[i2];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i2 = 0; i2 < d.length; ++i2) {
    if (d[i2])
      t.push({ s: i2, f: d[i2] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i22 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i22].f ? i0++ : i22++];
    r = t[i0 != i1 && t[i0].f < t[i22].f ? i0++ : i22++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i2 = 1; i2 < s; ++i2) {
    if (t2[i2].s > maxSym)
      maxSym = t2[i2].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i2 = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (; i2 < s; ++i2) {
      var i2_1 = t2[i2].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i2].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i2;
    }
    for (; i2 >= 0 && dt; --i2) {
      var i2_3 = t2[i2].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i2 = 1; i2 <= s; ++i2) {
    if (c[i2] == cln && i2 != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (; cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i2];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i2 = 0; i2 < cl.length; ++i2)
    l += cf[i2] * cl[i2];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i2 = 0; i2 < s; ++i2)
    out[o + i2 + 4] = dat[i2];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i2 = 0; i2 < lclt.length; ++i2)
    ++lcfreq[lclt[i2] & 31];
  for (var i2 = 0; i2 < lcdt.length; ++i2)
    ++lcfreq[lcdt[i2] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i2 = 0; i2 < nlcc; ++i2)
      wbits(out, p + 3 * i2, lct[clim[i2]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0; it < 2; ++it) {
      var clct = lcts[it];
      for (var i2 = 0; i2 < clct.length; ++i2) {
        var len = clct[i2] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i2] >> 5 & 127), p += clct[i2] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i2 = 0; i2 < li; ++i2) {
    var sym = syms[i2];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i3) {
      return (dat[i3] ^ dat[i3 + 1] << bs1_1 ^ dat[i3 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25e3);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i2 = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i2 + 2 < s; ++i2) {
      var hv = hsh(i2);
      var imod = i2 & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i2) {
        var rem = s - i2;
        if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i2 - bs, pos);
          li = lc_1 = eb = 0, bs = i2;
          for (var j = 0; j < 286; ++j)
            lf[j] = 0;
          for (var j = 0; j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i2 - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i2);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i2 + l] == dat[i2 + l - dif]) {
              var nl = 0;
              for (; nl < ml && dat[i2 + nl] == dat[i2 + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0; j < mmd; ++j) {
                  var ti = i2 - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i2 + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i2];
          ++lf[dat[i2]];
        }
      }
    }
    for (i2 = Math.max(i2, wi); i2 < s; ++i2) {
      syms[li++] = dat[i2];
      ++lf[dat[i2]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i2 - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i2, st.w = wi;
    }
  } else {
    for (var i2 = st.w || 0; i2 < s + lst; i2 += 65535) {
      var e = i2 + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i2, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ (function() {
  var t = new Int32Array(256);
  for (var i2 = 0; i2 < 256; ++i2) {
    var c = i2, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i2] = c;
  }
  return t;
})();
var crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i2 = 0; i2 < d.length; ++i2)
        cr = crct[cr & 255 ^ d[i2]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var mrg = function(a, b) {
  var o = {};
  for (var k in a)
    o[k] = a[k];
  for (var k in b)
    o[k] = b[k];
  return o;
};
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
var wbytes = function(d, b, v) {
  for (; v; ++b)
    d[b] = v, v >>>= 8;
};
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var fltn = function(d, p, t, o) {
  for (var k in d) {
    var val = d[k], n = p + k, op = o;
    if (Array.isArray(val))
      op = mrg(o, val[1]), val = val[0];
    if (ArrayBuffer.isView(val))
      t[n] = [val, op];
    else {
      t[n += "/"] = [new u8(0), op];
      fltn(val, n, t, o);
    }
  }
};
var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
var dutf8 = function(d) {
  for (var r = "", i2 = 0; ; ) {
    var c = d[i2++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i2 + eb > d.length)
      return { s: r, r: slc(d, i2 - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i2++] & 63) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i2++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63);
  }
};
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i2 = 0; i2 < str.length; ++i2)
      ar_1[i2] = str.charCodeAt(i2);
    return ar_1;
  }
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i2 = 0; i2 < l; ++i2) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i2 << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i2);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i2) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i2 = 0; i2 < dat.length; i2 += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
  var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
  var _a2 = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + efl + b2(d, b + 32), off];
};
var z64hs = function(d, b, l, z, sc, su, off) {
  var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
  var nf = nsc + nsu + noff;
  if (z && nf) {
    for (; b + 4 < e; b += 4 + b2(d, b + 2)) {
      if (b2(d, b) == 1) {
        return [
          nsc ? b8(d, b + 4 + 8 * nsu) : sc,
          nsu ? b8(d, b + 4) : su,
          noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
          1
        ];
      }
    }
    if (z < 2)
      err(13);
  }
  return [sc, su, off, 0];
};
var exfl = function(ex) {
  var le = 0;
  if (ex) {
    for (var k in ex) {
      var l = ex[k].length;
      if (l > 65535)
        err(9);
      le += l + 4;
    }
  }
  return le;
};
var wzh = function(d, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d[b++] = 20, d[b++] = f.os;
  d[b] = 20, b += 2;
  d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err(10);
  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl2);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col);
    wbytes(d, b + 6, f.attrs);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d.set(co, b), b += col;
  return b;
};
var wzf = function(o, b, c, d, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
  wbytes(o, b + 16, e);
};
function zipSync(data, opts) {
  if (!opts)
    opts = {};
  var r = {};
  var files = [];
  fltn(data, "", r, opts);
  var o = 0;
  var tot = 0;
  for (var fn in r) {
    var _a2 = r[fn], file = _a2[0], p = _a2[1];
    var compression = p.level == 0 ? 0 : 8;
    var f = strToU8(fn), s = f.length;
    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
    var exl = exfl(p.extra);
    if (s > 65535)
      err(11);
    var d = compression ? deflateSync(file, p) : file, l = d.length;
    var c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d,
      f,
      m,
      u: s != fn.length || m && com.length != ms,
      o,
      compression
    }));
    o += 30 + s + exl + l;
    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
  }
  var out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (var i2 = 0; i2 < files.length; ++i2) {
    var f = files[i2];
    wzh(out, f.o, f, f.f, f.u, f.c.length);
    var badd = 30 + f.f.length + exfl(f.extra);
    out.set(f.c, f.o + badd);
    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
  }
  wzf(out, o, files.length, cdl, oe);
  return out;
}
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (; b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  ;
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = b4(data, e - 20) == 117853008;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i2 = 0; i2 < c; ++i2) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// src/gp7-percussion-patch.ts
var GPIF_PATH = "Content/score.gpif";
var INSTRUMENT_SET_PATTERN = /<InstrumentSet>(.*?)<\/InstrumentSet>/gs;
var ARTICULATION_PATTERN = /<Articulation>.*?<\/Articulation>/gs;
var OUTPUT_MIDI_PATTERN = /<OutputMidiNumber>(\d+)<\/OutputMidiNumber>/;
var NOTE_PATTERN = /<Note\b.*?<\/Note>/gs;
var ARTICULATION_INDEX_PATTERN = /<InstrumentArticulation>(\d+)<\/InstrumentArticulation>/;
var STRING_PROPERTY = '<Property name="String">';
function patchPercussionNotesInGpif(gpif) {
  const articulationMidi = buildDrumKitMidiMap(gpif);
  if (articulationMidi.length === 0) {
    return gpif;
  }
  return gpif.replace(NOTE_PATTERN, (note) => {
    if (note.includes(STRING_PROPERTY)) {
      return note;
    }
    const articulation = note.match(ARTICULATION_INDEX_PATTERN);
    if (!articulation) {
      return note;
    }
    const midi2 = articulationMidi[parseInt(articulation[1], 10)];
    if (midi2 == null) {
      return note;
    }
    const properties = `<Property name="Fret"><Fret>${midi2}</Fret></Property><Property name="Midi"><Number>${midi2}</Number></Property>`;
    return note.replace("</Properties>", properties + "</Properties>");
  });
}
function buildDrumKitMidiMap(gpif) {
  for (const match of gpif.matchAll(INSTRUMENT_SET_PATTERN)) {
    const instrumentSet = match[1];
    if (!instrumentSet.includes("<Type>drumKit</Type>")) {
      continue;
    }
    const midiByArticulationIndex = [];
    for (const articulation of instrumentSet.matchAll(ARTICULATION_PATTERN)) {
      const midi2 = articulation[0].match(OUTPUT_MIDI_PATTERN);
      midiByArticulationIndex.push(midi2 ? parseInt(midi2[1], 10) : null);
    }
    return midiByArticulationIndex;
  }
  return [];
}
function patchGp7Percussion(gp7) {
  const entries = unzipSync(gp7);
  const gpifBytes = entries[GPIF_PATH];
  if (!gpifBytes) {
    return gp7;
  }
  const gpif = new TextDecoder().decode(gpifBytes);
  const patched = patchPercussionNotesInGpif(gpif);
  if (patched === gpif) {
    return gp7;
  }
  entries[GPIF_PATH] = new TextEncoder().encode(patched);
  return zipSync(entries);
}

// src/gp7-harmonic-patch.ts
var GPIF_PATH2 = "Content/score.gpif";
var NOTE_PATTERN2 = /<Note\b.*?<\/Note>/gs;
var HARMONIC_TYPE_PATTERN = /<Property name="HarmonicType"><HType>([^<]+)<\/HType><\/Property>/;
var CONCERT_PITCH_PATTERN = /<Property name="ConcertPitch"><Pitch>([\s\S]*?)<\/Pitch><\/Property>/;
var MIDI_PATTERN = /<Property name="Midi"><Number>(\d+)<\/Number><\/Property>/;
var STEP_PATTERN = /<Step>([A-G])<\/Step>/;
var OCTAVE_PATTERN = /<Octave>(-?\d+)<\/Octave>/;
var ACCIDENTAL_PATTERN = /<Accidental>([^<]*)<\/Accidental>/;
var STEP_SEMITONES = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};
var ACCIDENTAL_SEMITONES = {
  "": 0,
  "#": 1,
  x: 2,
  b: -1,
  bb: -2
};
function patchHarmonicNotesInGpif(gpif) {
  return gpif.replace(NOTE_PATTERN2, (note) => {
    const harmonicType = note.match(HARMONIC_TYPE_PATTERN);
    if (!harmonicType || harmonicType[1].toLowerCase() === "noharmonic") {
      return note;
    }
    const concertPitch = note.match(CONCERT_PITCH_PATTERN);
    const midi2 = note.match(MIDI_PATTERN);
    if (!concertPitch || !midi2) {
      return note;
    }
    const frettedMidi = pitchXmlToMidi(concertPitch[1]);
    if (frettedMidi == null || frettedMidi === parseInt(midi2[1], 10)) {
      return note;
    }
    return note.replace(
      midi2[0],
      `<Property name="Midi"><Number>${frettedMidi}</Number></Property>`
    );
  });
}
function pitchXmlToMidi(pitchXml) {
  const step = pitchXml.match(STEP_PATTERN);
  const octave = pitchXml.match(OCTAVE_PATTERN);
  if (!step || !octave) {
    return null;
  }
  const accidental = pitchXml.match(ACCIDENTAL_PATTERN);
  const semitones = STEP_SEMITONES[step[1]] + ACCIDENTAL_SEMITONES[accidental?.[1] ?? ""];
  if (Number.isNaN(semitones)) {
    return null;
  }
  return parseInt(octave[1], 10) * 12 + semitones;
}
function patchGp7Harmonics(gp7) {
  const entries = unzipSync(gp7);
  const gpifBytes = entries[GPIF_PATH2];
  if (!gpifBytes) {
    return gp7;
  }
  const gpif = new TextDecoder().decode(gpifBytes);
  const patched = patchHarmonicNotesInGpif(gpif);
  if (patched === gpif) {
    return gp7;
  }
  entries[GPIF_PATH2] = new TextEncoder().encode(patched);
  return zipSync(entries);
}

// src/songsterr-to-alphatab.converter.ts
var MAX_WARNINGS = 200;
var velocityToDynamicMap = {
  ppp: alphaTab2.model.DynamicValue.PPP,
  pp: alphaTab2.model.DynamicValue.PP,
  p: alphaTab2.model.DynamicValue.P,
  mp: alphaTab2.model.DynamicValue.MP,
  mf: alphaTab2.model.DynamicValue.MF,
  f: alphaTab2.model.DynamicValue.F,
  ff: alphaTab2.model.DynamicValue.FF,
  fff: alphaTab2.model.DynamicValue.FFF
};
var harmonicTypeMap = {
  natural: alphaTab2.model.HarmonicType.Natural,
  artificial: alphaTab2.model.HarmonicType.Artificial,
  pinch: alphaTab2.model.HarmonicType.Pinch,
  tap: alphaTab2.model.HarmonicType.Tap,
  semi: alphaTab2.model.HarmonicType.Semi,
  feedback: alphaTab2.model.HarmonicType.Feedback
};
function getTupletRatio(tuplet) {
  switch (tuplet) {
    case 3:
      return [3, 2];
    case 5:
      return [5, 4];
    case 6:
      return [6, 4];
    case 7:
      return [7, 4];
    case 9:
      return [9, 8];
    case 10:
      return [10, 8];
    case 12:
      return [12, 8];
    default:
      if (tuplet > 1) {
        const denominator = Math.pow(2, Math.floor(Math.log2(tuplet)));
        return [tuplet, denominator];
      }
      return [1, 1];
  }
}
function buildPercussionIndexMap() {
  const score = new alphaTab2.model.Score();
  const mb = new alphaTab2.model.MasterBar();
  score.addMasterBar(mb);
  const track = new alphaTab2.model.Track();
  track.playbackInfo.primaryChannel = 9;
  track.playbackInfo.secondaryChannel = 9;
  const staff = new alphaTab2.model.Staff();
  staff.isPercussion = true;
  track.addStaff(staff);
  const bar = new alphaTab2.model.Bar();
  const voice = new alphaTab2.model.Voice();
  const beat = new alphaTab2.model.Beat();
  beat.isEmpty = true;
  voice.addBeat(beat);
  bar.addVoice(voice);
  staff.addBar(bar);
  score.addTrack(track);
  const settings = new alphaTab2.Settings();
  score.finish(settings);
  const exporter2 = new alphaTab2.exporter.Gp7Exporter();
  const data = exporter2.export(score, settings);
  const reimported = alphaTab2.importer.ScoreLoader.loadScoreFromBytes(
    data,
    settings
  );
  const map = /* @__PURE__ */ new Map();
  const articulations = reimported.tracks[0].percussionArticulations;
  for (let i2 = 0; i2 < articulations.length; i2++) {
    const id = articulations[i2].id;
    if (!map.has(id)) {
      map.set(id, i2);
    }
  }
  return map;
}
var percussionIndexMap = null;
function ensurePercussionIndexMap() {
  if (!percussionIndexMap) {
    percussionIndexMap = buildPercussionIndexMap();
  }
  return percussionIndexMap;
}
function getPercussionArticulationIndex(midiNote) {
  return ensurePercussionIndexMap().get(midiNote) ?? midiNote;
}
function encodeVariableLengthQuantity(value) {
  const bytes = [value & 127];
  let remaining = value >> 7;
  while (remaining > 0) {
    bytes.unshift(remaining & 127 | 128);
    remaining >>= 7;
  }
  return bytes;
}
function addTrackNamesToMidi(midiData, trackNames) {
  const bytes = Array.from(midiData);
  const headerSize = 14;
  let offset = headerSize;
  for (let trackIndex = 0; trackIndex < trackNames.length; trackIndex++) {
    if (offset + 8 > bytes.length) break;
    const chunkId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    if (chunkId !== "MTrk") {
      throw new Error(`Unexpected MIDI chunk ${chunkId} at offset ${offset}`);
    }
    const length = bytes[offset + 4] << 24 | bytes[offset + 5] << 16 | bytes[offset + 6] << 8 | bytes[offset + 7];
    const trackDataStart = offset + 8;
    const trackDataEnd = trackDataStart + length;
    const trackName = trackNames[trackIndex] || `Track ${trackIndex + 1}`;
    const trackNameBytes = Array.from(new TextEncoder().encode(trackName));
    const metaEvent = [
      0,
      255,
      3,
      ...encodeVariableLengthQuantity(trackNameBytes.length),
      ...trackNameBytes
    ];
    bytes.splice(trackDataStart, 0, ...metaEvent);
    const newLength = length + metaEvent.length;
    bytes[offset + 4] = newLength >> 24 & 255;
    bytes[offset + 5] = newLength >> 16 & 255;
    bytes[offset + 6] = newLength >> 8 & 255;
    bytes[offset + 7] = newLength & 255;
    offset = trackDataEnd + metaEvent.length;
  }
  return Uint8Array.from(bytes);
}
var SongsterrToAlphaTabConverter = class {
  toGp7(input) {
    const { score, settings, warnings } = this.buildScore(input);
    score.finish(settings);
    const exporter2 = new alphaTab2.exporter.Gp7Exporter();
    const data = patchGp7Harmonics(patchGp7Percussion(exporter2.export(score, settings)));
    return { data, warnings };
  }
  toMidi(input, options = {}) {
    const { score, settings, warnings } = this.buildScore(input);
    score.finish(settings);
    const midiFile = new alphaTab2.midi.MidiFile();
    midiFile.format = options.separateTracks ? alphaTab2.midi.MidiFileFormat.MultiTrack : alphaTab2.midi.MidiFileFormat.SingleTrackMultiChannel;
    const handler = new alphaTab2.midi.AlphaSynthMidiFileHandler(midiFile, true);
    const generator = new alphaTab2.midi.MidiFileGenerator(score, settings, handler);
    generator.generate();
    let data = midiFile.toBinary();
    if (options.separateTracks) {
      const trackNames = score.tracks.map((track, index) => {
        const candidate = track.name?.trim() || track.shortName?.trim();
        return candidate || `Track ${index + 1}`;
      });
      data = addTrackNamesToMidi(data, trackNames);
    }
    return { data, warnings };
  }
  buildScore({ meta, revisions }) {
    const warnings = [];
    ensurePercussionIndexMap();
    const score = new alphaTab2.model.Score();
    score.title = meta.title;
    score.artist = meta.artist;
    score.tab = "Songsterr Downloader";
    const masterTrack = this.pickMasterTrack(revisions);
    const masterBarCount = Math.max(1, this.getMasterBarCount(revisions));
    this.buildMasterBars({
      score,
      masterTrack,
      masterBarCount,
      warnings
    });
    let nextChannel = 0;
    for (const entry of revisions) {
      const instrumentId = entry.trackMeta.instrumentId ?? entry.revision.instrumentId;
      const isPercussion = instrumentId === 1024 || !!entry.trackMeta.isDrums;
      let channel;
      if (isPercussion) {
        channel = 9;
      } else {
        if (nextChannel === 9) nextChannel++;
        channel = nextChannel;
        nextChannel++;
      }
      this.buildTrack({
        score,
        entry,
        masterBarCount,
        warnings,
        channel
      });
    }
    const settings = new alphaTab2.Settings();
    score.finish(settings);
    return { score, settings, warnings };
  }
  buildMasterBars({
    score,
    masterTrack,
    masterBarCount,
    warnings
  }) {
    let timeSignatureNumerator = 4;
    let timeSignatureDenominator = 4;
    for (let index = 0; index < masterBarCount; index++) {
      const measure = masterTrack?.measures?.[index];
      const signature = this.getValidSignature(measure?.signature);
      if (signature) {
        [timeSignatureNumerator, timeSignatureDenominator] = signature;
      }
      const masterBar = new alphaTab2.model.MasterBar();
      masterBar.timeSignatureNumerator = timeSignatureNumerator;
      masterBar.timeSignatureDenominator = timeSignatureDenominator;
      if (measure?.marker) {
        const section = new alphaTab2.model.Section();
        const markerText = this.extractMarkerText(measure.marker);
        section.marker = markerText;
        section.text = markerText;
        masterBar.section = section;
      }
      if (measure?.repeatStart) {
        masterBar.isRepeatStart = true;
      }
      const repeatCount = typeof measure?.repeat === "number" ? measure.repeat : typeof measure?.repeatCount === "number" ? measure.repeatCount : 0;
      if (repeatCount > 0) {
        masterBar.repeatCount = repeatCount;
      }
      const alternateEnding = measure?.alternateEnding;
      let alternateMask = 0;
      if (Array.isArray(alternateEnding)) {
        for (const n of alternateEnding) {
          if (typeof n === "number" && n >= 1 && n <= 8) {
            alternateMask |= 1 << n - 1;
          }
        }
      } else if (typeof alternateEnding === "number" && alternateEnding > 0) {
        alternateMask = alternateEnding;
      }
      if (alternateMask) {
        masterBar.alternateEndings = alternateMask;
      }
      if (measure?.doubleBarline) {
        masterBar.isDoubleBar = true;
      }
      score.addMasterBar(masterBar);
    }
    const tempoPoints = this.findTempoPoints(masterTrack);
    this.applyTempoAutomations(score, tempoPoints, warnings);
  }
  buildTrack({
    score,
    entry,
    masterBarCount,
    warnings,
    channel
  }) {
    const { trackMeta, revision } = entry;
    const playbackMapping = mapSongsterrInstrumentToPlayback(
      trackMeta.instrumentId ?? revision.instrumentId
    );
    const track = new alphaTab2.model.Track();
    track.name = trackMeta.title || trackMeta.name || revision.name || "Track";
    track.shortName = track.name.slice(0, 20);
    track.playbackInfo.program = playbackMapping.program;
    track.playbackInfo.primaryChannel = channel;
    track.playbackInfo.secondaryChannel = channel;
    const staff = new alphaTab2.model.Staff();
    const tuning = revision.tuning || trackMeta.tuning;
    if (Array.isArray(tuning) && tuning.length > 0) {
      staff.stringTuning = new alphaTab2.model.Tuning("Custom", tuning, false);
    }
    const isPercussion = playbackMapping.isPercussion || !!trackMeta.isDrums;
    staff.isPercussion = isPercussion;
    const numStrings = Array.isArray(tuning) ? tuning.length : 6;
    let maxVoiceCount = 1;
    for (let i2 = 0; i2 < masterBarCount; i2++) {
      const m = revision.measures?.[i2];
      maxVoiceCount = Math.max(maxVoiceCount, m?.voices?.length || 0);
    }
    for (let measureIndex = 0; measureIndex < masterBarCount; measureIndex++) {
      const bar = new alphaTab2.model.Bar();
      const measure = revision.measures?.[measureIndex];
      const voiceCount = measure?.voices?.length || 0;
      if (voiceCount === 0) {
        const voice = new alphaTab2.model.Voice();
        this.fillWithRestBeats(voice, score.masterBars[measureIndex]);
        bar.addVoice(voice);
      } else {
        for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++) {
          const voice = new alphaTab2.model.Voice();
          const sourceVoice = measure.voices[voiceIndex];
          this.fillVoice({
            voice,
            sourceVoice,
            masterBar: score.masterBars[measureIndex],
            warnings,
            locationPrefix: `track:${trackMeta.partId}|measure:${measureIndex}|voice:${voiceIndex}`,
            isPercussion,
            numStrings
          });
          bar.addVoice(voice);
        }
      }
      for (let v = bar.voices.length; v < maxVoiceCount; v++) {
        const restVoice = new alphaTab2.model.Voice();
        this.fillWithRestBeats(restVoice, score.masterBars[measureIndex]);
        bar.addVoice(restVoice);
      }
      staff.addBar(bar);
    }
    track.addStaff(staff);
    score.addTrack(track);
  }
  fillVoice({
    voice,
    sourceVoice,
    masterBar,
    warnings,
    locationPrefix,
    isPercussion,
    numStrings
  }) {
    const beats = sourceVoice?.beats || [];
    if (beats.length === 0 || sourceVoice?.rest) {
      this.fillWithRestBeats(voice, masterBar);
      return;
    }
    for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
      const beatData = beats[beatIndex];
      const beat = this.mapBeat(
        beatData,
        warnings,
        `${locationPrefix}|beat:${beatIndex}`,
        isPercussion,
        numStrings
      );
      voice.addBeat(beat);
    }
    if (voice.beats.length === 0) {
      this.fillWithRestBeats(voice, masterBar);
    }
  }
  mapBeat(beatData, warnings, location, isPercussion, numStrings) {
    const beat = new alphaTab2.model.Beat();
    if (beatData.rest) {
      beat.isEmpty = true;
    }
    const mappedDuration = mapSongsterrDuration(beatData.duration);
    beat.duration = mappedDuration.duration;
    beat.dots = beatData.dots ?? mappedDuration.dots;
    const rawText = beatData.text;
    const textStr = typeof rawText === "string" ? rawText : rawText?.text;
    beat.text = textStr || null;
    if (mappedDuration.isApproximate && !beatData.tuplet) {
      this.pushWarning(warnings, {
        code: "duration_approximated",
        message: `Approximated unsupported duration ${JSON.stringify(
          beatData.duration
        )}`,
        location
      });
    }
    if (typeof beatData.graceNote === "string") {
      const gn = beatData.graceNote.toLowerCase();
      if (gn === "beforebeat") {
        beat.graceType = alphaTab2.model.GraceType.BeforeBeat;
      } else if (gn === "onbeat") {
        beat.graceType = alphaTab2.model.GraceType.OnBeat;
      }
    }
    if (typeof beatData.tuplet === "number" && beatData.tuplet > 1) {
      const [num, den] = getTupletRatio(beatData.tuplet);
      beat.tupletNumerator = num;
      beat.tupletDenominator = den;
      if (typeof beatData.type === "number" && beatData.type > 0) {
        const baseDuration = mapSongsterrDuration([1, beatData.type]);
        beat.duration = baseDuration.duration;
        beat.dots = beatData.dots ?? 0;
      }
    }
    if (typeof beatData.velocity === "string") {
      const mappedDynamic = velocityToDynamicMap[beatData.velocity.toLowerCase()];
      if (typeof mappedDynamic === "number") {
        beat.dynamics = mappedDynamic;
      } else {
        this.pushWarning(warnings, {
          code: "velocity_unknown",
          message: `Unsupported beat velocity "${beatData.velocity}"`,
          location
        });
      }
    }
    if (typeof beatData.pickStroke === "string") {
      const ps = beatData.pickStroke.toLowerCase();
      if (ps === "down") {
        beat.pickStroke = alphaTab2.model.PickStroke.Down;
      } else if (ps === "up") {
        beat.pickStroke = alphaTab2.model.PickStroke.Up;
      }
    }
    if (beatData.wideVibrato || beatData.vibratoWithTremoloBar) {
      beat.vibrato = alphaTab2.model.VibratoType.Wide;
    } else if (beatData.vibrato) {
      beat.vibrato = alphaTab2.model.VibratoType.Slight;
    }
    const notes = beatData.notes || [];
    for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
      const noteData = notes[noteIndex];
      if (noteData.rest) {
        continue;
      }
      const note = this.mapNote(
        noteData,
        beatData,
        warnings,
        `${location}|note:${noteIndex}`,
        isPercussion,
        numStrings
      );
      beat.addNote(note);
    }
    return beat;
  }
  mapNote(noteData, beatData, warnings, location, isPercussion, numStrings) {
    const note = new alphaTab2.model.Note();
    note.string = isPercussion ? -1 : numStrings - (noteData.string ?? 0);
    note.fret = noteData.fret ?? 0;
    if (isPercussion) {
      note.percussionArticulation = getPercussionArticulationIndex(
        noteData.fret ?? 0
      );
    }
    if (noteData.tie) {
      note.isTieDestination = true;
    }
    if (noteData.dead) {
      note.isDead = true;
    }
    if (noteData.ghost) {
      note.isGhost = true;
    }
    if (noteData.hp) {
      note.isHammerPullOrigin = true;
    }
    if (noteData.staccato) {
      note.isStaccato = true;
    }
    if (noteData.accentuated) {
      note.accentuated = alphaTab2.model.AccentuationType.Normal;
    }
    if (beatData.palmMute) {
      note.isPalmMute = true;
    }
    if (noteData.wideVibrato) {
      note.vibrato = alphaTab2.model.VibratoType.Wide;
    } else if (noteData.vibrato) {
      note.vibrato = alphaTab2.model.VibratoType.Slight;
    }
    if (typeof noteData.slide === "string") {
      this.mapSlide(note, noteData.slide, warnings, location);
    }
    if (typeof noteData.harmonic === "string") {
      this.mapHarmonic(note, noteData, warnings, location);
    }
    if (noteData.bend && noteData.bend.points && noteData.bend.points.length > 0) {
      this.mapBend(note, noteData.bend);
    }
    return note;
  }
  mapSlide(note, slide, warnings, location) {
    const normalizedSlide = slide.toLowerCase();
    if (normalizedSlide === "shift") {
      note.slideOutType = alphaTab2.model.SlideOutType.Shift;
      return;
    }
    if (normalizedSlide === "legato") {
      note.slideOutType = alphaTab2.model.SlideOutType.Legato;
      return;
    }
    if (normalizedSlide === "into_from_below" || normalizedSlide === "below") {
      note.slideInType = alphaTab2.model.SlideInType.IntoFromBelow;
      return;
    }
    if (normalizedSlide === "into_from_above") {
      note.slideInType = alphaTab2.model.SlideInType.IntoFromAbove;
      return;
    }
    if (normalizedSlide === "out_up") {
      note.slideOutType = alphaTab2.model.SlideOutType.OutUp;
      return;
    }
    if (normalizedSlide === "out_down" || normalizedSlide === "downwards") {
      note.slideOutType = alphaTab2.model.SlideOutType.OutDown;
      return;
    }
    this.pushWarning(warnings, {
      code: "slide_unsupported",
      message: `Unsupported slide effect "${slide}"`,
      location
    });
  }
  mapHarmonic(note, noteData, warnings, location) {
    const harmonicStr = noteData.harmonic.toLowerCase();
    const mappedType = harmonicTypeMap[harmonicStr];
    if (typeof mappedType === "number") {
      note.harmonicType = mappedType;
      if (typeof noteData.harmonicFret === "number") {
        note.harmonicValue = noteData.harmonicFret;
      }
    } else {
      this.pushWarning(warnings, {
        code: "harmonic_unsupported",
        message: `Unsupported harmonic type "${noteData.harmonic}"`,
        location
      });
    }
  }
  mapBend(note, bend) {
    const points = bend.points;
    if (!points || points.length === 0) return;
    const toAlphaTabValue = (tone) => Math.round(tone / 25);
    const firstTone = points[0].tone;
    const isPrebend = firstTone > 0;
    if (isPrebend) {
      const firstVal = toAlphaTabValue(firstTone);
      const lastPoint = points[points.length - 1];
      const destVal = toAlphaTabValue(lastPoint.tone);
      const maxTone = Math.max(...points.map((p) => p.tone));
      if (maxTone > firstTone) {
        note.bendType = alphaTab2.model.BendType.PrebendBend;
        const maxVal = toAlphaTabValue(maxTone);
        note.addBendPoint(new alphaTab2.model.BendPoint(0, firstVal));
        note.addBendPoint(new alphaTab2.model.BendPoint(60, maxVal));
      } else if (lastPoint.tone < firstTone) {
        note.bendType = alphaTab2.model.BendType.PrebendRelease;
        note.addBendPoint(new alphaTab2.model.BendPoint(0, firstVal));
        note.addBendPoint(new alphaTab2.model.BendPoint(60, destVal));
      } else {
        note.bendType = alphaTab2.model.BendType.Prebend;
        note.addBendPoint(new alphaTab2.model.BendPoint(0, firstVal));
        note.addBendPoint(new alphaTab2.model.BendPoint(60, destVal));
      }
      return;
    }
    note.bendType = alphaTab2.model.BendType.Custom;
    let pointsToUse = points;
    if (points.length > 4) {
      let maxTone = 0;
      let peakIdx = 0;
      for (let i2 = 0; i2 < points.length; i2++) {
        if (points[i2].tone >= maxTone) {
          maxTone = points[i2].tone;
          peakIdx = i2;
        }
      }
      if (peakIdx === 0 || peakIdx === points.length - 1) {
        pointsToUse = [points[0], points[points.length - 1]];
      } else {
        pointsToUse = [points[0], points[peakIdx], points[points.length - 1]];
      }
    }
    for (const point of pointsToUse) {
      const offset = Math.round(point.position);
      const value = toAlphaTabValue(point.tone);
      note.addBendPoint(new alphaTab2.model.BendPoint(offset, value));
    }
  }
  fillWithRestBeats(voice, masterBar) {
    const denominator = masterBar.timeSignatureDenominator || 4;
    const numerator = masterBar.timeSignatureNumerator || 4;
    const mappedDuration = mapSongsterrDuration([1, denominator]);
    for (let i2 = 0; i2 < numerator; i2++) {
      const restBeat = new alphaTab2.model.Beat();
      restBeat.isEmpty = true;
      restBeat.duration = mappedDuration.duration;
      restBeat.dots = mappedDuration.dots;
      voice.addBeat(restBeat);
    }
  }
  getMasterBarCount(revisions) {
    return revisions.reduce((max2, entry) => {
      return Math.max(max2, entry.revision?.measures?.length || 0);
    }, 0);
  }
  pickMasterTrack(revisions) {
    if (revisions.length === 0) {
      return null;
    }
    return revisions.reduce((longest, current) => {
      const currentLength = current.revision?.measures?.length || 0;
      const longestLength = longest.revision?.measures?.length || 0;
      return currentLength > longestLength ? current : longest;
    }).revision;
  }
  getValidSignature(signature) {
    if (!Array.isArray(signature) || signature.length !== 2) {
      return null;
    }
    const [numerator, denominator] = signature;
    if (!numerator || !denominator) {
      return null;
    }
    return [numerator, denominator];
  }
  extractMarkerText(marker) {
    if (typeof marker === "string") {
      return marker;
    }
    if (marker && typeof marker === "object" && typeof marker.text === "string") {
      return marker.text;
    }
    return "";
  }
  findTempoPoints(masterTrack) {
    const tempo = masterTrack?.automations?.tempo;
    return Array.isArray(tempo) ? tempo : [];
  }
  applyTempoAutomations(score, points, warnings) {
    for (const point of points) {
      const barIndex = point.measure;
      const masterBar = score.masterBars[barIndex];
      if (!masterBar) {
        this.pushWarning(warnings, {
          code: "tempo_measure_out_of_range",
          message: `Tempo automation references missing measure ${barIndex}`,
          location: `measure:${barIndex}`
        });
        continue;
      }
      const tempoReference = 2;
      const ratioPosition = point.position > 0 ? Math.max(0, Math.min(1, point.position / (point.type || 4))) : 0;
      const tempoAutomation = alphaTab2.model.Automation.buildTempoAutomation(
        false,
        ratioPosition,
        point.bpm,
        tempoReference,
        true
      );
      masterBar.tempoAutomations.push(tempoAutomation);
    }
  }
  pushWarning(warnings, warning) {
    if (warnings.length < MAX_WARNINGS) {
      warnings.push(warning);
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SongsterrToAlphaTabConverter
});
