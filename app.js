(() => {
  "use strict";

  const BOT = window.BOT, CATS = window.CATEGORIES, CMDS = window.COMMANDS;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PAGE = 12;

  /* ---------------------------------------------------------
     Нормализация и нечёткий поиск
     --------------------------------------------------------- */
  const norm = s => String(s).toLowerCase().replace(/ё/g, "е");
  const tokenize = s => norm(s).split(/[^a-zа-я0-9#@]+/i).filter(Boolean);

  // раскладка: английские буквы <-> русские
  const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
  const RU = "йцукенгшщзхъфывапролджэячсмитьбю" + "е";
  const en2ru = {}, ru2en = {};
  for (let i = 0; i < EN.length; i++) { en2ru[EN[i]] = RU[i]; ru2en[RU[i]] = EN[i]; }
  const swapLayout = s => {
    const m = /[a-z]/i.test(s) ? en2ru : ru2en;
    return [...norm(s)].map(c => m[c] || c).join("");
  };

  // расстояние Дамерау–Левенштейна (опечатки и перестановки соседних букв)
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  function commonPrefix(a, b) {
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i;
  }

  // насколько слово запроса t похоже на слово w (0 — совсем нет)
  function wordScore(t, w) {
    if (t === w) return 100;
    if (w.startsWith(t)) return 85;
    if (t.length >= 4 && t.startsWith(w) && w.length >= 3) return 72;   // «переводить» → «перевод»
    if (t.length >= 3 && w.includes(t)) return 58;
    const p = commonPrefix(t, w);
    if (p >= 4 && p >= Math.min(t.length, w.length) - 3) return 60;     // формы слов: перевести / перевод
    const max = t.length <= 3 ? 0 : t.length <= 5 ? 1 : 2;
    if (max) {
      const d = dist(t, w.slice(0, Math.max(t.length, 1) + 1), max);    // опечатки, в т.ч. в начале слова
      const d2 = dist(t, w, max);
      const best = Math.min(d, d2);
      if (best <= max) return 52 - best * 9;
    }
    return 0;
  }

  // готовим индекс один раз
  const FIELDS = [
    ["name", 3], ["aliases", 2.5], ["cat", 1.2], ["desc", 1], ["usage", 1], ["example", .6]
  ];
  const catName = id => (CATS.find(c => c.id === id) || {}).name || "";
  CMDS.forEach((c, i) => {
    c._i = i;
    c._idx = {
      name: tokenize(c.name),
      aliases: tokenize((c.aliases || []).join(" ")),
      cat: tokenize(catName(c.cat) + (c.admin ? " админ администратор" : "")),
      desc: tokenize(c.desc),
      usage: tokenize(c.usage),
      example: tokenize(c.example || "")
    };
  });

  // возвращает { s: сумма баллов, n: сколько слов запроса нашлось }
  function scoreCommand(c, tokens) {
    let s = 0, n = 0;
    for (const t of tokens) {
      let best = 0;
      for (const [f, wgt] of FIELDS) {
        for (const w of c._idx[f]) {
          const v = wordScore(t, w) * wgt;
          if (v > best) best = v;
        }
      }
      if (best >= 45) { s += best; n++; }
    }
    return { s, n };
  }

  function search(query) {
    const tokens = tokenize(query).filter(t => t.length > 1 || /\d/.test(t));
    if (!tokens.length) return null;

    // строгий поиск: найдены все слова; мягкий: хотя бы одно
    const rank = (toks, strict) => CMDS
      .map(c => ({ c, ...scoreCommand(c, toks) }))
      .filter(x => strict ? x.n === toks.length : x.n > 0)
      .sort((a, b) => b.n - a.n || b.s - a.s || a.c._i - b.c._i);

    let res = rank(tokens, true), note = "", used = tokens;
    if (!res.length) {
      // возможно, включена не та раскладка
      const alt = tokenize(swapLayout(query)).filter(t => t.length > 1);
      const res2 = alt.length ? rank(alt, true) : [];
      if (res2.length) {
        res = res2; used = alt;
        note = `Показаны результаты для «<b>${esc(swapLayout(query))}</b>» — раскладка была другой.`;
      }
    }
    if (!res.length && tokens.length > 1) {
      res = rank(tokens, false);
      if (res.length) note = "Точных совпадений нет — показаны похожие команды.";
    }
    return { res, tokens: used, note };
  }

  // «Возможно, вы имели в виду…» — ближайшие названия команд
  function suggestions(query) {
    const q = norm(query).replace(/\s+/g, "_");
    const pool = [];
    CMDS.forEach(c => [c.name, ...(c.aliases || [])].forEach(n => {
      const nn = norm(n).replace(/\s+/g, "_");
      pool.push({ n: c.name, d: Math.min(dist(q, nn, 9), dist(swapLayout(q), nn, 9)) });
    }));
    const seen = new Set();
    return pool.sort((a, b) => a.d - b.d).filter(x => !seen.has(x.n) && seen.add(x.n)).slice(0, 3).map(x => x.n);
  }

  function hl(text, tokens) {
    const low = norm(text); const ranges = [];
    tokens.forEach(t => {
      if (t.length < 2) return;
      const i = low.indexOf(t);
      if (i >= 0) ranges.push([i, i + t.length]);
    });
    if (!ranges.length) return esc(text);
    ranges.sort((a, b) => a[0] - b[0]);
    let out = "", pos = 0;
    for (const [s, e] of ranges) {
      if (s < pos) continue;
      out += esc(text.slice(pos, s)) + "<mark>" + esc(text.slice(s, e)) + "</mark>";
      pos = e;
    }
    return out + esc(text.slice(pos));
  }

  /* ---------------------------------------------------------
     Состояние и отрисовка
     --------------------------------------------------------- */
  const state = { q: "", cat: "all", admin: false, expanded: false };

  function fillProfile() {
    document.title = `${BOT.name} — команды бота`;
    $("#botUser").textContent = `Бот: ${BOT.handle}`;
    $("#botOnline").textContent = BOT.status;
    $("#botNote").innerHTML = BOT.note.map(l => `<p>${esc(l)}</p>`).join("");
    $("#ghLink").href = BOT.github;
    $("#cur").textContent = BOT.currency;
    $("#srv").textContent = `${BOT.name} на ${BOT.server}`;
    $("#tabCount").textContent = CMDS.length;
    $("#year").textContent = new Date().getFullYear();
    $("#tabDate").textContent = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
    $("#howList").innerHTML = BOT.howTo.map(h => `<li>${esc(h.where)}<code>${esc(h.code)}</code></li>`).join("");
  }

  function renderSide() {
    $("#cats tbody").innerHTML = CATS.map((c, i) => {
      const n = CMDS.filter(x => x.cat === c.id && (!state.admin || x.admin)).length;
      return `<tr class="cat${state.cat === c.id ? " on" : ""}" data-cat="${c.id}"><td>${i + 1}.</td><td>${esc(c.name)}</td><td class="r">${n}</td></tr>`;
    }).join("");

    $("#btnAll").classList.toggle("on", state.cat === "all" && !state.admin && !state.q);
    $("#btnAdmin").classList.toggle("on", state.admin);
  }

  function cardHTML(c, tokens) {
    const cat = CATS.find(x => x.id === c.cat);
    const aliases = (c.aliases || []).length
      ? `<div class="aliases">${c.aliases.map(a => `<span>${hl(a, tokens)}</span>`).join("")}</div>` : "";
    const ex = c.example
      ? `<button class="use" data-copy="${esc(c.example)}"><small>Пример</small>${esc(c.example)}</button>` : "";
    return `
      <article class="cmd">
        <div class="cmd-h">
          <span class="tag">${hl(c.name, tokens)}</span>
          <span class="meta">• ${esc(cat ? cat.name : "")}</span>
          ${c.admin ? '<span class="badge">админ</span>' : ""}
        </div>
        <div class="cmd-b">
          <p>${hl(c.desc, tokens)}</p>
          ${aliases}
          <button class="use" data-copy="${esc(c.usage)}"><small>Как написать</small>${hl(c.usage, tokens)}</button>
          ${ex}
        </div>
      </article>`;
  }

  function render() {
    renderSide();
    const hint = $("#hint");
    let items, tokens = [], title, note = "";

    const filtered = CMDS.filter(c => (state.cat === "all" || c.cat === state.cat) && (!state.admin || c.admin));
    const s = search(state.q);

    if (s) {
      const ok = new Set(filtered.map(c => c._i));
      items = s.res.map(x => x.c).filter(c => ok.has(c._i));
      tokens = s.tokens; note = s.note;
      title = `Найдено: ${items.length}`;
    } else {
      items = filtered;
      title = state.admin ? "Админ-команды" : state.cat === "all" ? "Все команды" : catName(state.cat);
    }
    $("#feedTitle").textContent = title;

    // подсказка под строкой поиска
    if (note) hint.innerHTML = note;
    else if (s && !items.length) {
      const sg = suggestions(state.q);
      hint.innerHTML = `Ничего не нашлось. Может, вы искали: ${sg.map(n => `<button data-q="${esc(n)}">${esc(n)}</button>`).join(" ")}`;
    } else hint.textContent = "";

    const limit = !s && !state.expanded && state.cat === "all" && !state.admin ? PAGE : Infinity;
    const shown = items.slice(0, limit);
    $("#list").innerHTML = shown.length
      ? shown.map(c => cardHTML(c, tokens)).join("")
      : `<div class="empty"><big>Пусто</big>Попробуй другое слово или сбрось фильтры.</div>`;

    const more = $("#more");
    more.hidden = items.length <= shown.length;
    more.textContent = `Показать ещё команды… (${items.length - shown.length})`;
  }

  /* ---------------------------------------------------------
     События
     --------------------------------------------------------- */
  let timer;
  $("#q").addEventListener("input", e => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value; render(); }, 90);
  });

  document.addEventListener("click", e => {
    const t = e.target.closest("[data-cat],[data-q],[data-copy],.dot[data-theme],#btnAll,#btnAdmin,#more");
    if (!t) return;
    if (t.dataset.cat) {
      state.cat = state.cat === t.dataset.cat ? "all" : t.dataset.cat; render();
    } else if (t.dataset.q) {
      $("#q").value = t.dataset.q; state.q = t.dataset.q; render();
    } else if (t.dataset.copy) {
      copy(t.dataset.copy);
    } else if (t.dataset.theme) {
      setTheme(t.dataset.theme);
    } else if (t.id === "btnAll") {
      Object.assign(state, { q: "", cat: "all", admin: false, expanded: false }); $("#q").value = ""; render();
    } else if (t.id === "btnAdmin") {
      state.admin = !state.admin; render();
    } else if (t.id === "more") {
      e.preventDefault(); state.expanded = true; render();
    }
  });

  document.addEventListener("keydown", e => {
    const typing = /input|textarea/i.test(document.activeElement.tagName);
    if (e.key === "/" && !typing) { e.preventDefault(); $("#q").focus(); }
    if (e.key === "Escape" && document.activeElement === $("#q")) {
      $("#q").value = ""; state.q = ""; render(); $("#q").blur();
    }
  });

  function copy(text) {
    const done = () => { const el = $("#toast"); el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 1300); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, done);
    else {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
      ta.select(); try { document.execCommand("copy"); } catch (_) {} ta.remove(); done();
    }
  }

  function setTheme(name) {
    document.documentElement.dataset.theme = name;
    try { localStorage.setItem("theme", name); } catch (_) {}
  }
  try { const t = localStorage.getItem("theme"); if (t) setTheme(t); } catch (_) {}

  fillProfile();
  render();
})();
