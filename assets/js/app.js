/* 今日热榜 · 前端路由与渲染 */
(function () {
  'use strict';

  var POSTS = window.POSTS || [];
  var TAGS = window.TAGS || {};
  var HOT = window.HOTLIST || { items: [] };
  var app = document.getElementById('app');

  /* ---------- 工具 ---------- */
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var REFRESH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>';
  var sorted = POSTS.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var bySlug = function (s) { return POSTS.filter(function (p) { return p.slug === s; })[0]; };
  var readingTime = function (md) { return Math.max(1, Math.round(md.replace(/\s/g, '').length / 380)); };
  var countOf = function (tag) { return POSTS.filter(function (p) { return p.tags.indexOf(tag) > -1; }).length; };
  var tagName = function (slug) { return TAGS[slug] || slug; };

  // 热度值各平台单位不同，统一做「万 / 亿」缩写
  function fmtHeat(h) {
    var n = parseFloat(String(h).replace(/[^0-9.]/g, ''));
    if (!n) return esc(h);
    if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
    return String(n);
  }

  /* ---------- 代码块轻量语法高亮（零依赖） ---------- */
  var KEYWORDS = {
    python: ('def class return if elif else for while in not and or is None True False ' +
      'try except finally with as lambda import from raise pass yield assert global ' +
      'async await continue break print int str bool float list dict set tuple len range self').split(' '),
    javascript: ('const let var function return if else for while do switch case class new this ' +
      'null undefined true false import export from default try catch finally typeof ' +
      'instanceof async await throw delete in of continue break extends super yield static get set').split(' '),
    json: 'true false null'.split(' '),
    bash: ('if then fi for do done echo cd ls sudo apt yum pip python git curl ' +
      'mkdir rm cp mv export source chmod').split(' '),
    sql: ('select from where insert into update delete create table join on group order ' +
      'by limit having as and or not null values set').split(' ')
  };
  KEYWORDS.js = KEYWORDS.javascript;
  KEYWORDS.py = KEYWORDS.python;
  KEYWORDS.shell = KEYWORDS.bash;

  // 只转义 < > &：代码内容是文本节点，引号无需转义，方便后续按原文做词法处理
  function escCode(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function hl(code, lang) {
    var src = escCode(code);
    var store = [];
    // 占位符延后在最后统一插入标签，避免关键字匹配到 class 名导致 HTML 被破坏
    function keep(cls, txt) {
      store.push([cls, txt]);
      return '\u0001' + (store.length - 1) + '\u0002';
    }
    if (lang === 'python') {
      src = src.replace(/(#[^\n]*)/g, function (_, c) { return keep('cm', c); });
    }
    if (lang === 'javascript' || lang === 'js') {
      src = src.replace(/(\/\/[^\n]*)/g, function (_, c) { return keep('cm', c); });
    }
    src = src.replace(/('[^'\n]*'|"[^"\n]*")/g, function (_, s) { return keep('str', s); });
    src = src.replace(/\b(\d+(?:\.\d+)?)\b/g, function (_, n) { return keep('num', n); });
    (KEYWORDS[lang] || []).forEach(function (k) {
      src = src.replace(new RegExp('\\b' + k + '\\b', 'g'), '\u0003' + k + '\u0004');
    });
    src = src.replace(/\u0001(\d+)\u0002/g, function (_, i) {
      var it = store[+i];
      return '<span class="tok-' + it[0] + '">' + it[1] + '</span>';
    });
    src = src.replace(/\u0003([^\u0004]*)\u0004/g, function (_, w) {
      return '<span class="tok-kw">' + w + '</span>';
    });
    return src;
  }

  function highlightBlocks() {
    Array.prototype.forEach.call(app.querySelectorAll('pre code'), function (el) {
      var m = /language-([\w-]+)/.exec(el.className || '');
      var lang = m ? m[1].toLowerCase() : 'text';
      var pre = el.parentNode;
      if (pre) pre.setAttribute('data-lang', lang);
      if (lang === 'text' || !KEYWORDS[lang]) return;
      el.innerHTML = hl(el.textContent, lang);
    });
  }

  function fmtDate(d) {
    var p = d.split('-');
    return p[0] + ' 年 ' + Number(p[1]) + ' 月 ' + Number(p[2]) + ' 日';
  }
  function fmtShort(d) { return d.slice(5).replace('-', '/'); }

  marked.setOptions({ gfm: true, breaks: false });

  /* ---------- 组件 ---------- */
  function postCard(p) {
    return '<article class="post-card">' +
      '<h3><a href="#/post/' + p.slug + '">' + esc(p.title) + '</a></h3>' +
      '<p class="post-excerpt">' + esc(p.excerpt) + '</p>' +
      '<div class="post-meta">' +
        '<span>' + fmtDate(p.date) + '</span><i class="sep"></i>' +
        '<span>约 ' + readingTime(p.body) + ' 分钟</span><i class="sep"></i>' +
        p.tags.map(function (t) {
          return '<a class="tag-chip" href="#/tag/' + t + '">' + esc(tagName(t)) + '</a>';
        }).join('') +
      '</div></article>';
  }

  // 升降趋势标记：上升红、下降绿（符合国内阅读习惯），新上榜单独标记
  function trendBadge(it) {
    if (it.isNew) return '<span class="trend is-new">NEW</span>';
    var d = Number(it.delta) || 0;
    if (d > 0) return '<span class="trend up">↑' + d + '</span>';
    if (d < 0) return '<span class="trend down">↓' + Math.abs(d) + '</span>';
    return '<span class="trend flat">—</span>';
  }

  function hotTip(it) {
    var t = it.track;
    if (!t) return esc(it.title);
    return esc(it.title) + '\n首次上榜：' + esc(t.first) +
      '\n累计上榜：' + t.hits + ' 次' +
      '\n最高排名：第 ' + t.best + ' 位';
  }

  function itemRow(it) {
    return '<div class="hot-item"><span class="rank">' + it.rank + '</span>' +
      '<a class="hot-title" href="' + esc(it.url) + '" target="_blank" rel="noopener" title="' + hotTip(it) + '">' + esc(it.title) + '</a>' +
      trendBadge(it) +
      '<span class="src">' + esc(it.source) + '</span>' +
      '<span class="heat">' + fmtHeat(it.heat) + '</span></div>';
  }

  function itemsHtml(list) { return list.map(itemRow).join(''); }

  function hotItemsHtml(limit) {
    return itemsHtml(HOT.items.slice(0, limit || HOT.items.length));
  }

  function hotPanel(limit) {
    var lim = limit || 12;
    return '<section class="card hot">' +
      '<div class="hot-head"><span class="t"><i class="dot"></i>今日热榜速览</span>' +
      '<span class="hu-wrap"><button class="refresh-btn" id="hot-refresh" type="button" ' +
      'title="刷新热榜（每 5 分钟自动）" aria-label="刷新热榜">' + REFRESH_SVG + '</button>' +
      '<span class="u" data-hot-updated>更新于 ' + esc(HOT.updatedAt) + '</span></span></div>' +
      '<div class="hot-list" data-hot-list data-hot-limit="' + lim + '">' + hotItemsHtml(lim) + '</div></section>';
  }

  function sideBar(activeTag) {
    var tops = sorted.slice(0, 5);
    return '<aside class="side">' +
      '<div class="side-card"><h4>标签分类</h4><div class="tag-cloud">' +
        Object.keys(TAGS).map(function (t) {
          return '<a class="' + (t === activeTag ? 'on' : '') + '" href="#/tag/' + t + '">' +
            esc(tagName(t)) + '<span>' + countOf(t) + '</span></a>';
        }).join('') +
      '</div></div>' +
      '<div class="side-card"><h4>最新文章</h4><div class="mini-list">' +
        tops.map(function (p, i) {
          return '<div class="mini-item"><span class="n">' + (i + 1) + '</span>' +
            '<a href="#/post/' + p.slug + '">' + esc(p.title) + '</a></div>';
        }).join('') +
      '</div></div>' +
      '<div class="side-card about-mini"><h4>关于本站</h4>' +
        '<p>一个记录全网热搜、热播与舆论观察的个人博客。不追快，只记值得回头看的东西。</p>' +
        '<a class="btn" href="#/about">了解更多 →</a></div>' +
      '</aside>';
  }

  /* ---------- 页面：首页 ---------- */
  function pageHome() {
    var list = sorted.slice(0, 6);
    return '<div class="wrap"><div class="layout">' +
      '<div>' +
        '<section class="hero"><h1>今天，网上在聊什么？</h1>' +
        '<p>把每天的热搜、热播与热议整理成可读的观察笔记 —— 不追快讯，只记录值得回头看的部分。</p>' +
        '<div class="hero-meta">' +
          '<div><b>' + POSTS.length + '</b>篇观察笔记</div>' +
          '<div><b>' + Object.keys(TAGS).length + '</b>个内容分类</div>' +
          '<div><b>' + HOT.items.length + '</b>条在榜热点</div>' +
          '<div><b data-hot-time>' + esc(HOT.updatedAt.slice(11)) + '</b>最近更新时间</div>' +
        '</div></section>' +
        '<div class="sec-head"><h2>今日热榜速览</h2>' +
          '<a class="more" href="#/tags">全部分类 →</a></div>' +
        hotPanel(12) +
        '<div class="sec-head"><h2>最新文章</h2>' +
          '<a class="more" href="#/tags">按标签浏览 →</a></div>' +
        '<div class="post-list">' + list.map(postCard).join('') + '</div>' +
      '</div>' +
      sideBar() +
      '</div></div>';
  }

  /* ---------- 页面：文章详情 ---------- */
  function pagePost(slug) {
    var p = bySlug(slug);
    if (!p) return '<div class="wrap"><div class="empty">没有找到这篇文章 · <a href="#/">返回首页</a></div></div>';

    var raw = marked.parse(p.body);
    var tmp = document.createElement('div');
    tmp.innerHTML = raw;
    var toc = [];
    Array.prototype.forEach.call(tmp.querySelectorAll('h2, h3'), function (h, i) {
      var id = 'sec-' + i;
      h.id = id;
      toc.push({ id: id, text: h.textContent, lv: h.tagName.toLowerCase() === 'h3' ? 3 : 2 });
    });

    var idx = sorted.indexOf(p);
    var prev = sorted[idx - 1], next = sorted[idx + 1];
    var related = sorted.filter(function (o) {
      return o.slug !== p.slug && o.tags.some(function (t) { return p.tags.indexOf(t) > -1; });
    }).slice(0, 5);

    return '<div class="wrap"><div class="layout">' +
      '<div><article class="card article">' +
        '<div class="article-head">' +
          '<div class="article-meta">' +
            p.tags.map(function (t) { return '<a class="tag-chip" href="#/tag/' + t + '">' + esc(tagName(t)) + '</a>'; }).join('') +
          '</div>' +
          '<h1>' + esc(p.title) + '</h1>' +
          '<div class="article-meta"><span>' + fmtDate(p.date) + '</span><i class="sep"></i>' +
            '<span>约 ' + readingTime(p.body) + ' 分钟</span><i class="sep"></i>' +
            '<span>' + p.body.replace(/\s/g, '').length + ' 字</span></div>' +
        '</div>' +
        (toc.length > 2 ? '<nav class="toc"><b>目录</b>' + toc.map(function (t) {
          return '<a class="lv' + t.lv + '" href="javascript:void(0)" data-go="' + t.id + '">' + esc(t.text) + '</a>';
        }).join('') + '</nav>' : '') +
        '<div class="md">' + tmp.innerHTML + '</div>' +
        '<div class="article-tags">' +
          p.tags.map(function (t) { return '<a class="tag-chip" href="#/tag/' + t + '">#' + esc(tagName(t)) + '</a>'; }).join('') +
        '</div>' +
      '</article>' +
      '<div class="pager">' +
        (prev ? '<a href="#/post/' + prev.slug + '"><span class="lab">上一篇</span>' + esc(prev.title) + '</a>' : '<span></span>') +
        (next ? '<a class="next" href="#/post/' + next.slug + '"><span class="lab">下一篇</span>' + esc(next.title) + '</a>' : '<span></span>') +
      '</div></div>' +
      '<aside class="side">' +
        (toc.length > 2 ? '<div class="side-card"><h4>本文目录</h4><div class="mini-list">' +
          toc.map(function (t) {
            return '<div class="mini-item"><span class="n">·</span><a href="javascript:void(0)" data-go="' + t.id + '">' + esc(t.text) + '</a></div>';
          }).join('') + '</div></div>' : '') +
        (related.length ? '<div class="side-card"><h4>相关阅读</h4><div class="mini-list">' +
          related.map(function (r) {
            return '<div class="mini-item"><span class="n">▸</span><a href="#/post/' + r.slug + '">' + esc(r.title) + '</a></div>';
          }).join('') + '</div></div>' : '') +
          '<div class="side-card"><h4>今日热榜</h4>' +
          '<div class="hot-list" data-hot-list data-hot-limit="5">' + hotItemsHtml(5) + '</div></div>' +
      '</aside>' +
      '</div></div>';
  }

  /* ---------- 页面：标签总览 ---------- */
  function pageTags() {
    var max = Math.max.apply(null, Object.keys(TAGS).map(countOf)) || 1;
    return '<div class="wrap"><div class="page-head"><h1>标签分类</h1>' +
      '<p>按主题浏览全部 ' + POSTS.length + ' 篇文章，共 ' + Object.keys(TAGS).length + ' 个分类。</p></div>' +
      '<div class="tag-grid">' + Object.keys(TAGS).map(function (t) {
        var c = countOf(t);
        return '<a class="tag-box" href="#/tag/' + t + '">' +
          '<div class="name">' + esc(tagName(t)) + '</div>' +
          '<div class="cnt">' + c + ' 篇文章</div>' +
          '<div class="bar"><i style="width:' + Math.round(c / max * 100) + '%"></i></div></a>';
      }).join('') + '</div>' +
      '<div class="sec-head"><h2>全部文章</h2></div>' +
      '<div class="post-list">' + sorted.map(postCard).join('') + '</div></div>';
  }

  /* ---------- 页面：单标签 ---------- */
  function pageTag(tag) {
    if (!TAGS[tag]) return '<div class="wrap"><div class="empty">没有这个标签 · <a href="#/tags">查看全部分类</a></div></div>';
    var list = sorted.filter(function (p) { return p.tags.indexOf(tag) > -1; });
    return '<div class="wrap"><div class="layout">' +
      '<div><div class="page-head"><h1>#' + esc(tagName(tag)) + '</h1>' +
        '<p>共 ' + list.length + ' 篇文章 · <a href="#/tags" style="color:var(--accent)">← 全部分类</a></p></div>' +
        '<div class="post-list">' + (list.length ? list.map(postCard).join('') :
          '<div class="empty">这个分类下还没有文章</div>') + '</div></div>' +
      sideBar(tag) + '</div></div>';
  }

  /* ---------- 页面：搜索 ---------- */
  function pageSearch(q) {
    var k = q.trim().toLowerCase();
    var list = sorted.filter(function (p) {
      return (p.title + p.excerpt + p.body + p.tags.map(tagName).join()).toLowerCase().indexOf(k) > -1;
    });
    return '<div class="wrap"><div class="page-head"><h1>搜索：' + esc(q) + '</h1>' +
      '<p>找到 ' + list.length + ' 篇相关文章 · <a href="#/" style="color:var(--accent)">← 返回首页</a></p></div>' +
      '<div class="post-list">' + (list.length ? list.map(postCard).join('') :
        '<div class="empty">没有匹配的结果，换个关键词试试</div>') + '</div></div>';
  }

  /* ---------- 页面：关于 ---------- */
  function pageAbout() {
    var body = [
      '## 这是什么',
      '',
      '**今日热榜**是一个个人博客，记录我对全网热搜、热播与热点话题的观察。',
      '',
      '它不生产新闻，也不做实时快讯。每天的热榜内容浩如烟海，大部分会在 24 小时内被忘掉，我想做的是把那些**值得回头再看一遍**的部分留下来。',
      '',
      '## 我在观察什么',
      '',
      '- 一个话题是怎么被推上榜首，又怎么被冲下去的',
      '- 不同平台的榜单为什么长得完全不一样',
      '- 热度数字背后，真正的传播机制是什么',
      '',
      '## 内容分类',
      '',
      '| 分类 | 关注点 |',
      '| --- | --- |',
      '| 每日速读 | 当天榜单的三到五个重点话题 |',
      '| 微博热搜 | 情绪驱动型话题的起落 |',
      '| 知乎热榜 | 问题与答案的传播形态 |',
      '| 短视频 | 抖音、B 站等平台的流行差异 |',
      '| 影视热播 | 剧集与电影的播放数据观察 |',
      '| 科技数码 | 技术话题如何进入公共视野 |',
      '| 社会民生 | 与日常生活相关的公共议题 |',
      '| 财经观察 | 宏观数据与个体体感的落差 |',
      '| 榜单方法论 | 怎么读榜、怎么用榜 |',
      '| 技术手记 | 抓取、聚合与展示的实现 |',
      '',
      '## 关于热榜数据',
      '',
      '首页的「今日热榜速览」来自公开聚合站点的**静态快照**，存放于 `data/hotlist.js`，',
      '页面不会实时联网抓取。若要更新，替换该文件内容即可。',
      '',
      '> 榜单是「被排序过的信息入口」。它很高效，但它呈现的是一种秩序，而不是世界的全貌。',
      '',
      '## 技术实现',
      '',
      '本站是一个纯静态站点，没有后端、没有构建步骤：',
      '',
      '- 路由：原生 Hash 路由',
      '- 渲染：文章正文为 Markdown，由 marked.js 在浏览器端解析',
      '- 数据：文章与热榜快照均为本地 JS 数据文件',
      '- 样式：手写 CSS，含深色模式',
      '',
      '直接用浏览器打开 `index.html` 即可访问，也可以放到任意静态托管上。'
    ].join('\n');

    return '<div class="wrap"><div class="layout single">' +
      '<div><div class="card about-hero"><div class="avatar">热</div>' +
        '<div><h1>关于「今日热榜」</h1><p>一个记录热搜、热播与舆论观察的个人博客</p></div>' +
      '</div>' +
      '<article class="card article"><div class="md">' + marked.parse(body) + '</div></article>' +
      '</div></div></div>';
  }

  /* ---------- 页面：热榜风向（基于历史快照的数据洞察） ---------- */
  function barRow(label, val, max) {
    var w = max ? Math.round(val / max * 100) : 0;
    return '<div class="stat-row"><span class="stat-lab">' + esc(label) + '</span>' +
      '<span class="stat-bar"><i style="width:' + w + '%"></i></span>' +
      '<span class="stat-val">' + val + '</span></div>';
  }

  function statBox(n, label) {
    return '<div class="stat-box"><b>' + n + '</b><span>' + esc(label) + '</span></div>';
  }

  function pageInsights() {
    var s = HOT.stats || {};
    var items = HOT.items || [];
    var srcs = s.sources || {};

    if (!items.length) {
      return '<div class="wrap"><div class="empty">暂无热榜数据 · <a href="#/">返回首页</a></div></div>';
    }

    var maxSrc = Math.max.apply(null, Object.keys(srcs).map(function (k) { return srcs[k]; }).concat([1]));
    var news = items.filter(function (i) { return i.isNew; });
    var ups = items.filter(function (i) { return Number(i.delta) > 0; })
      .sort(function (a, b) { return b.delta - a.delta; }).slice(0, 10);
    var tops = items.slice().sort(function (a, b) {
      return ((b.track && b.track.hits) || 0) - ((a.track && a.track.hits) || 0);
    }).slice(0, 10);

    return '<div class="wrap" data-page="insights">' +
      '<div class="page-head"><h1>热榜风向</h1>' +
        '<p>基于抓取脚本留存的历史快照，观察话题的上榜轨迹与升降趋势' +
        (s.since ? '（数据累计起始于 ' + esc(s.since) + '）' : '') + '</p></div>' +

      (!s.crawls ? '<div class="tip">当前展示的是内置静态快照，尚未接入实时数据。' +
        '通过本地服务运行站点并执行 <code>tools/fetch_hotlist.py</code> 后，' +
        '这里会显示实时趋势、新上榜与在榜轨迹。</div>' : '') +

      '<div class="card stat-grid">' +
        statBox(s.total || items.length, '当前在榜') +
        statBox(Object.keys(srcs).length, '数据来源') +
        statBox(s.newCount || 0, '较上次新上榜') +
        statBox(s.tracked || 0, '已追踪词条') +
      '</div>' +

      '<div class="sec-head"><h2>来源分布</h2>' +
        '<span class="u">累计抓取 ' + (s.crawls || 0) + ' 次 · 上升 ' + (s.upCount || 0) +
        ' / 下降 ' + (s.downCount || 0) + '</span></div>' +
      '<div class="card insight-card">' +
        Object.keys(srcs).map(function (k) { return barRow(k, srcs[k], maxSrc); }).join('') +
      '</div>' +

      (news.length ? '<div class="sec-head"><h2>今日新上榜</h2>' +
        '<span class="u">共 ' + news.length + ' 条</span></div>' +
        '<div class="card hot"><div class="hot-list">' + itemsHtml(news.slice(0, 12)) + '</div></div>' : '') +

      (ups.length ? '<div class="sec-head"><h2>上升最快</h2><span class="u">较上次抓取</span></div>' +
        '<div class="card hot"><div class="hot-list">' + itemsHtml(ups) + '</div></div>' : '') +

      '<div class="sec-head"><h2>在榜最久</h2><span class="u">按累计上榜次数排序</span></div>' +
      '<div class="card insight-card"><div class="mini-list">' +
        tops.map(function (it, i) {
          var t = it.track;
          return '<div class="mini-item"><span class="n">' + (i + 1) + '</span>' +
            '<span>' + esc(it.title) +
            (t ? '<em class="hint"> ' + esc(it.source) + ' · 上榜 ' + t.hits + ' 次 · 最高第 ' + t.best + ' 位</em>' : '') +
            '</span></div>';
        }).join('') +
      '</div></div>' +
      '</div>';
  }

  /* ---------- 路由 ---------- */
  function currentPath() {
    var h = location.hash.replace(/^#/, '');
    return h || '/';
  }

  function render() {
    var path = decodeURIComponent(currentPath());
    var seg = path.split('/').filter(Boolean);
    var html, nav = '';

    if (seg.length === 0) { html = pageHome(); nav = 'home'; }
    else if (seg[0] === 'post' && seg[1]) { html = pagePost(seg[1]); nav = 'home'; }
    else if (seg[0] === 'insights') { html = pageInsights(); nav = 'insights'; }
    else if (seg[0] === 'tags') { html = pageTags(); nav = 'tags'; }
    else if (seg[0] === 'tag' && seg[1]) { html = pageTag(seg[1]); nav = 'tags'; }
    else if (seg[0] === 'about') { html = pageAbout(); nav = 'about'; }
    else if (seg[0] === 'search' && seg[1]) { html = pageSearch(seg[1]); }
    else { html = '<div class="wrap"><div class="empty">页面不存在 · <a href="#/">返回首页</a></div></div>'; }

    app.innerHTML = html;
    highlightBlocks();
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === nav);
    });

    if (path === '/' || seg[0] === 'post' || seg[0] === 'tag') window.scrollTo(0, 0);
  }

  /* ---------- 交互 ---------- */
  // 页内目录跳转：避免锚点污染 hash 路由
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-go]');
    if (!a) return;
    e.preventDefault();
    var el = document.getElementById(a.getAttribute('data-go'));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // 手动刷新热榜按钮
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#hot-refresh');
    if (!b || b.disabled) return;
    e.preventDefault();
    b.classList.add('loading');
    b.disabled = true;
    loadHot(function (ok) {
      b.classList.remove('loading');
      b.disabled = false;
      b.classList.add(ok ? 'done' : 'fail');
      b.title = ok ? '已更新' : '刷新失败，使用内置快照';
      setTimeout(function () {
        b.classList.remove('done', 'fail');
        b.title = '刷新热榜（每 5 分钟自动）';
      }, 1600);
    });
  });

  var input = document.getElementById('q');
  input.addEventListener('input', function () {
    var v = input.value.trim();
    if (v) location.hash = '#/search/' + encodeURIComponent(v);
    else if (currentPath().indexOf('/search') === 0) location.hash = '#/';
  });

  var THEME_KEY = 'hotlist-theme';
  var saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('theme-btn').addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
  });

  /* ---------- 实时热榜：定时拉取 data/hotlist.json ---------- */
  function refreshHot() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-hot-list]'), function (el) {
      var lim = parseInt(el.getAttribute('data-hot-limit') || '12', 10);
      el.innerHTML = hotItemsHtml(lim);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-hot-updated]'), function (el) {
      el.textContent = '更新于 ' + esc(HOT.updatedAt);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-hot-time]'), function (el) {
      el.textContent = esc(HOT.updatedAt.slice(11));
    });
    // 风向页依赖完整统计与轨迹字段，数据到达后需整页重渲染（保持滚动位置不打断）
    if (document.querySelector('[data-page="insights"]')) {
      var y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
  }

  function loadHot(onDone) {
    fetch('data/hotlist.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (d) {
        if (d && d.items && d.items.length) { HOT = d; refreshHot(); if (onDone) onDone(true); }
        else if (onDone) onDone(false);
      })
      .catch(function () { if (onDone) onDone(false); /* file:// 或网络不可达时回退内置快照 */ });
  }

  window.addEventListener('hashchange', render);
  render();
  loadHot();
  setInterval(loadHot, 5 * 60 * 1000);
})();
