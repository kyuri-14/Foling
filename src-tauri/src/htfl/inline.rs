// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Inline markup inside `content`.
//!
//! A sentence often carries a link, a highlighted word or a reading in ruby.
//! HTFL has one folder per element, and making a folder per emphasised word
//! is not workable — nor can a folder sit *between* two runs of text. So a
//! small, fixed set of phrasing tags may be written straight into an
//! element's text:
//!
//! `a` `strong` `em` `b` `i` `u` `s` `mark` `small` `code` `kbd` `sub` `sup`
//! `span` `br` `ruby` `rt` `rp`
//!
//! with `class`, `id` and `title` on any of them and `href` / `target` / `rel`
//! on `a`. Only a well-formed tag from that set is markup; everything else is
//! text, exactly as before. That keeps existing content — and prose that merely
//! mentions `<body>` — unchanged, and means a mistake shows up on the page as
//! the literal tag instead of breaking the document.
//!
//! A line break in the content is a line break on the page (`<br />`). Inside
//! `code` / `kbd` (as an inline tag or as the element) text is shown as
//! written, so code samples can mention tags. `script`, `style`, `title`,
//! `textarea`, `option` and anything inside `<pre>` keep their old treatment.

use serde::Serialize;

use super::*;

/// Phrasing tags that may be written inside an element's text.
pub const INLINE_TAGS: &[&str] = &[
    "a", "strong", "em", "b", "i", "u", "s", "mark", "small", "code", "kbd", "sub", "sup",
    "span", "br", "ruby", "rt", "rp",
];
const GLOBAL_ATTRS: &[&str] = &["class", "id", "title"];
const LINK_ATTRS: &[&str] = &["href", "target", "rel"];
/// Inline tags whose inside is shown as written.
const VERBATIM_INLINE: &[&str] = &["code", "kbd"];
/// A tag longer than this is not a tag (keeps a stray `<` cheap to scan past).
const MAX_TAG_LEN: usize = 2048;

/// How an element's `content` becomes HTML.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TextMode {
    /// Allowed inline tags are markup; a line break is `<br />`.
    Rich,
    /// All text (`code`, `kbd`, `samp`); a line break is `<br />`.
    Literal,
    /// The old treatment: escaped, line breaks not converted. For `script`,
    /// `style`, `title`, `textarea`, `option`, and anything inside `<pre>`.
    Raw,
}

pub fn text_mode(tag: &str, in_pre: bool) -> TextMode {
    if in_pre {
        return TextMode::Raw;
    }
    match tag {
        "script" | "style" | "title" | "textarea" | "option" | "pre" => TextMode::Raw,
        "code" | "kbd" | "samp" => TextMode::Literal,
        _ => TextMode::Rich,
    }
}

/// Something written like an inline tag that is shown as text instead.
#[derive(Clone, Debug, Serialize)]
pub struct InlineIssue {
    /// "unclosed" | "stray-close" | "attribute" | "href" | "nested-link" | "self-closing"
    pub kind: &'static str,
    pub tag: String,
    /// The attribute or URL at fault, when there is one.
    pub detail: String,
}

impl InlineIssue {
    /// One line of English, for MCP diagnostics.
    pub fn describe(&self) -> String {
        match self.kind {
            "unclosed" => format!("<{}> is never closed — it is shown as text", self.tag),
            "stray-close" => format!("</{}> closes nothing — it is shown as text", self.tag),
            "attribute" => format!(
                "<{}> has the attribute '{}', which is not allowed inside text — the tag is shown as text",
                self.tag, self.detail
            ),
            "href" => format!(
                "<a> links to '{}', which is not an allowed URL (http, https, mailto, tel or relative) — the tag is shown as text",
                self.detail
            ),
            "nested-link" => "<a> inside a link is not allowed — the tag is shown as text".into(),
            _ => format!("<{}/> cannot be self-closing — it is shown as text", self.tag),
        }
    }
}

#[derive(Clone, Debug)]
enum Tok {
    Text(String),
    Open {
        name: String,
        attrs: Vec<(String, Option<String>)>,
        self_closing: bool,
        raw: String,
    },
    Close {
        name: String,
        raw: String,
    },
}

impl Tok {
    fn raw(&self) -> &str {
        match self {
            Tok::Text(t) => t,
            Tok::Open { raw, .. } | Tok::Close { raw, .. } => raw,
        }
    }
}

/// Try to read an allowed inline tag at the start of `s` (which starts with
/// `<`). Returns the token and its length in bytes.
fn parse_tag(s: &str) -> Option<(Tok, usize)> {
    let b = s.as_bytes();
    let mut i = 1;
    let closing = b.get(i) == Some(&b'/');
    if closing {
        i += 1;
    }
    let name_start = i;
    while i < b.len() && b[i].is_ascii_alphanumeric() {
        i += 1;
    }
    if i == name_start || !b[name_start].is_ascii_alphabetic() {
        return None;
    }
    let name = s[name_start..i].to_ascii_lowercase();
    if !INLINE_TAGS.contains(&name.as_str()) {
        return None;
    }
    let mut attrs: Vec<(String, Option<String>)> = Vec::new();
    let mut self_closing = false;
    loop {
        if i > MAX_TAG_LEN {
            return None;
        }
        let ws_start = i;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        match b.get(i)? {
            b'>' => {
                i += 1;
                break;
            }
            b'/' if b.get(i + 1) == Some(&b'>') && !closing => {
                self_closing = true;
                i += 2;
                break;
            }
            _ => {
                // A closing tag has no attributes; attributes are separated by space.
                if closing || i == ws_start {
                    return None;
                }
                let an_start = i;
                while i < b.len()
                    && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'-' | b'_' | b':' | b'.'))
                {
                    i += 1;
                }
                if i == an_start {
                    return None;
                }
                let an = s[an_start..i].to_ascii_lowercase();
                let mut j = i;
                while j < b.len() && b[j].is_ascii_whitespace() {
                    j += 1;
                }
                if b.get(j) == Some(&b'=') {
                    j += 1;
                    while j < b.len() && b[j].is_ascii_whitespace() {
                        j += 1;
                    }
                    let (value, next) = match *b.get(j)? {
                        q @ (b'"' | b'\'') => {
                            let end = j + 1 + s[j + 1..].find(q as char)?;
                            (s[j + 1..end].to_string(), end + 1)
                        }
                        _ => {
                            let mut k = j;
                            while k < b.len()
                                && !b[k].is_ascii_whitespace()
                                && !matches!(b[k], b'>' | b'"' | b'\'' | b'<' | b'=' | b'`')
                            {
                                k += 1;
                            }
                            if k == j {
                                return None;
                            }
                            (s[j..k].to_string(), k)
                        }
                    };
                    attrs.push((an, Some(value)));
                    i = next;
                } else {
                    attrs.push((an, None));
                }
            }
        }
    }
    let raw = s[..i].to_string();
    let tok = if closing {
        Tok::Close { name, raw }
    } else {
        Tok::Open {
            name,
            attrs,
            self_closing,
            raw,
        }
    };
    Some((tok, i))
}

fn tokenize(s: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut i = 0;
    while i < s.len() {
        if s.as_bytes()[i] == b'<' {
            if let Some((tok, len)) = parse_tag(&s[i..]) {
                if !text.is_empty() {
                    out.push(Tok::Text(std::mem::take(&mut text)));
                }
                out.push(tok);
                i += len;
                continue;
            }
        }
        let ch = s[i..].chars().next().unwrap_or('\0');
        text.push(ch);
        i += ch.len_utf8().max(1);
    }
    if !text.is_empty() {
        out.push(Tok::Text(text));
    }
    out
}

/// http(s), mailto, tel, or a relative URL. Everything else — `javascript:`
/// above all — is refused.
fn safe_href(v: &str) -> bool {
    let compact: String = v
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_control())
        .collect::<String>()
        .to_ascii_lowercase();
    match compact.find(':') {
        None => true,
        // A ':' after '/', '?' or '#' belongs to the path, not a scheme.
        Some(at) if compact[..at].contains(['/', '?', '#']) => true,
        Some(at) => matches!(&compact[..at], "http" | "https" | "mailto" | "tel"),
    }
}

/// Why an opening tag cannot be markup, if it cannot.
fn open_problem(
    name: &str,
    attrs: &[(String, Option<String>)],
    self_closing: bool,
) -> Option<InlineIssue> {
    let issue = |kind, detail: &str| {
        Some(InlineIssue {
            kind,
            tag: name.to_string(),
            detail: detail.to_string(),
        })
    };
    if self_closing && name != "br" {
        return issue("self-closing", "");
    }
    let mut seen: Vec<&str> = Vec::new();
    for (k, v) in attrs {
        let allowed = GLOBAL_ATTRS.contains(&k.as_str())
            || (name == "a" && LINK_ATTRS.contains(&k.as_str()));
        if !allowed || seen.contains(&k.as_str()) {
            return issue("attribute", k);
        }
        seen.push(k);
        if k == "href" && !safe_href(v.as_deref().unwrap_or("")) {
            return issue("href", v.as_deref().unwrap_or(""));
        }
    }
    None
}

/// Escape text, turning each line break into `<br />`.
fn push_text(out: &mut String, text: &str) {
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push_str("<br />");
        }
        out.push_str(&escape_html(line));
    }
}

fn normalize(content: &str) -> String {
    let unified = content.replace("\r\n", "\n").replace('\r', "\n");
    unified.trim_end_matches('\n').to_string()
}

/// The result of rendering one element's content.
#[derive(Clone, Debug, Default, Serialize)]
pub struct InlineRender {
    pub html: String,
    pub issues: Vec<InlineIssue>,
}

/// Render `content` for an element whose text mode is `mode` (not `Raw`; the
/// builder handles that itself). `element_tag` is the element the text sits
/// in: inside an `<a>`, a nested link is refused.
pub fn render_content(content: &str, mode: TextMode, element_tag: &str) -> InlineRender {
    let content = normalize(content);
    let mut r = InlineRender::default();
    if mode != TextMode::Rich {
        push_text(&mut r.html, &content);
        return r;
    }

    let toks = tokenize(&content);
    // markup[i]: token i is emitted as a tag; verbatim_to[i]: an inline
    // code/kbd opened at i, whose inside up to the given close is text.
    let mut markup = vec![false; toks.len()];
    let mut verbatim_to: Vec<Option<usize>> = vec![None; toks.len()];
    let mut stack: Vec<usize> = Vec::new();
    let in_link = |stack: &Vec<usize>| {
        element_tag == "a"
            || stack
                .iter()
                .any(|&k| matches!(&toks[k], Tok::Open { name, .. } if name == "a"))
    };

    let mut i = 0;
    while i < toks.len() {
        match &toks[i] {
            Tok::Open {
                name,
                attrs,
                self_closing,
                ..
            } => {
                if let Some(issue) = open_problem(name, attrs, *self_closing) {
                    r.issues.push(issue);
                } else if name == "br" {
                    markup[i] = true;
                } else if name == "a" && in_link(&stack) {
                    r.issues.push(InlineIssue {
                        kind: "nested-link",
                        tag: "a".into(),
                        detail: String::new(),
                    });
                } else if VERBATIM_INLINE.contains(&name.as_str()) {
                    let close = (i + 1..toks.len())
                        .find(|&j| matches!(&toks[j], Tok::Close { name: n, .. } if n == name));
                    if let Some(j) = close {
                        markup[i] = true;
                        markup[j] = true;
                        verbatim_to[i] = Some(j);
                        i = j + 1;
                        continue;
                    }
                    r.issues.push(InlineIssue {
                        kind: "unclosed",
                        tag: name.clone(),
                        detail: String::new(),
                    });
                } else {
                    stack.push(i);
                }
            }
            Tok::Close { name, .. } => {
                let top = stack.last().copied();
                match top {
                    Some(t) if matches!(&toks[t], Tok::Open { name: n, .. } if n == name) => {
                        markup[t] = true;
                        markup[i] = true;
                        stack.pop();
                    }
                    _ => r.issues.push(InlineIssue {
                        kind: "stray-close",
                        tag: name.clone(),
                        detail: String::new(),
                    }),
                }
            }
            Tok::Text(_) => {}
        }
        i += 1;
    }
    for &k in &stack {
        if let Tok::Open { name, .. } = &toks[k] {
            r.issues.push(InlineIssue {
                kind: "unclosed",
                tag: name.clone(),
                detail: String::new(),
            });
        }
    }

    let mut i = 0;
    while i < toks.len() {
        let tok = &toks[i];
        if !markup[i] {
            push_text(&mut r.html, tok.raw());
            i += 1;
            continue;
        }
        match tok {
            Tok::Open { name, attrs, .. } => {
                if name == "br" {
                    r.html.push_str("<br />");
                } else {
                    r.html.push('<');
                    r.html.push_str(name);
                    for (k, v) in attrs {
                        r.html.push(' ');
                        r.html.push_str(k);
                        if let Some(v) = v {
                            r.html.push_str("=\"");
                            r.html.push_str(&escape_attr(v));
                            r.html.push('"');
                        }
                    }
                    r.html.push('>');
                }
                if let Some(j) = verbatim_to[i] {
                    for inner in &toks[i + 1..j] {
                        push_text(&mut r.html, inner.raw());
                    }
                    i = j;
                    continue;
                }
            }
            Tok::Close { name, .. } => {
                r.html.push_str("</");
                r.html.push_str(name);
                r.html.push('>');
            }
            Tok::Text(_) => unreachable!("text is never markup"),
        }
        i += 1;
    }
    r
}

/// The text a reader would see, on one line — for previews and search.
pub fn plain_text(content: &str) -> String {
    let rendered = render_content(content, TextMode::Rich, "");
    let mut out = String::new();
    let mut in_tag = false;
    let html = rendered.html.replace("<br />", " ");
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let text = out
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Collapse runs of HTML white space (space, tab, line breaks, form feed) to
/// one space and trim them from both ends — what a browser does to source
/// layout. Other spaces, such as the ideographic space (U+3000) or a
/// no-break space, are text and are kept.
pub fn collapse_html_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending = false;
    for c in s.chars() {
        if matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0C') {
            pending = !out.is_empty();
        } else {
            if pending {
                out.push(' ');
                pending = false;
            }
            out.push(c);
        }
    }
    out
}

/// Whether an imported element can be stored as text with inline tags:
/// every child is text or an allowed inline tag that would come back exactly
/// as it was.
pub fn importable_inline(el: scraper::ElementRef, in_link: bool) -> bool {
    el.children().all(|child| match child.value() {
        scraper::Node::Text(_) | scraper::Node::Comment(_) => true,
        scraper::Node::Element(e) => {
            let name = e.name().to_ascii_lowercase();
            if !INLINE_TAGS.contains(&name.as_str()) || (name == "a" && in_link) {
                return false;
            }
            let attrs: Vec<(String, Option<String>)> = e
                .attrs()
                .map(|(k, v)| (k.to_ascii_lowercase(), Some(v.to_string())))
                .collect();
            // A value holding both quote kinds cannot be written back.
            if attrs
                .iter()
                .any(|(_, v)| v.as_deref().is_some_and(|v| v.contains('"') && v.contains('\'')))
            {
                return false;
            }
            if open_problem(&name, &attrs, false).is_some() {
                return false;
            }
            let Some(inner) = scraper::ElementRef::wrap(child) else {
                return false;
            };
            if VERBATIM_INLINE.contains(&name.as_str()) {
                // Shown as written, so it may hold text only.
                return inner.children().all(|c| c.value().is_text());
            }
            importable_inline(inner, in_link || name == "a")
        }
        _ => false,
    })
}

/// Write an imported element's children as content with inline tags. White
/// space runs collapse to one space — they were only source layout, and a line
/// break in content now means `<br>` — while `<br>` itself becomes a line break.
pub fn import_inline_content(el: scraper::ElementRef) -> String {
    fn walk(el: scraper::ElementRef, out: &mut String) {
        for child in el.children() {
            match child.value() {
                scraper::Node::Text(t) => {
                    let mut last_space = out.ends_with(' ');
                    for c in t.chars() {
                        if matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0C') {
                            if !last_space {
                                out.push(' ');
                                last_space = true;
                            }
                        } else {
                            out.push(c);
                            last_space = false;
                        }
                    }
                }
                scraper::Node::Element(e) => {
                    let name = e.name().to_ascii_lowercase();
                    if name == "br" {
                        while out.ends_with(' ') {
                            out.pop();
                        }
                        out.push('\n');
                        continue;
                    }
                    out.push('<');
                    out.push_str(&name);
                    for (k, v) in e.attrs() {
                        let q = if v.contains('"') { '\'' } else { '"' };
                        out.push(' ');
                        out.push_str(&k.to_ascii_lowercase());
                        out.push('=');
                        out.push(q);
                        out.push_str(v);
                        out.push(q);
                    }
                    out.push('>');
                    if let Some(inner) = scraper::ElementRef::wrap(child) {
                        walk(inner, out);
                    }
                    out.push_str("</");
                    out.push_str(&name);
                    out.push('>');
                }
                _ => {}
            }
        }
    }
    let mut out = String::new();
    walk(el, &mut out);
    out.split('\n')
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rich(s: &str) -> InlineRender {
        render_content(s, TextMode::Rich, "p")
    }

    #[test]
    fn allowed_tags_become_markup_and_text_is_escaped() {
        let r = rich("Read <strong>this</strong> & <mark class=\"hi\">that</mark> < now");
        assert_eq!(
            r.html,
            "Read <strong>this</strong> &amp; <mark class=\"hi\">that</mark> &lt; now"
        );
        assert!(r.issues.is_empty());
    }

    #[test]
    fn a_line_break_is_br_and_trailing_breaks_are_dropped() {
        assert_eq!(rich("こんにちは\n世界\n").html, "こんにちは<br />世界");
        assert_eq!(rich("a\r\nb").html, "a<br />b");
        assert_eq!(rich("a<br>b<br/>c").html, "a<br />b<br />c");
    }

    #[test]
    fn links_keep_safe_urls_only() {
        let r = rich("<a href=\"/x?a=1&b=2\" target=\"_blank\">go</a>");
        assert_eq!(r.html, "<a href=\"/x?a=1&amp;b=2\" target=\"_blank\">go</a>");
        for bad in ["javascript:alert(1)", " JavaScript:x", "data:text/html,x"] {
            let r = rich(&format!("<a href=\"{bad}\">x</a>"));
            assert!(r.html.starts_with("&lt;a href="), "{bad}: {}", r.html);
            assert_eq!(r.issues[0].kind, "href");
        }
        assert!(rich("<a href=\"mailto:a@b.c\">m</a>").issues.is_empty());
        assert!(rich("<a href=\"page.html#x:y\">p</a>").issues.is_empty());
    }

    #[test]
    fn anything_not_well_formed_stays_text() {
        // Tags outside the set — e.g. prose about <body> — are plain text.
        assert_eq!(rich("the <body> element").html, "the &lt;body&gt; element");
        // Unclosed, stray and mismatched tags are text, and reported.
        let r = rich("<b>bold");
        assert_eq!(r.html, "&lt;b&gt;bold");
        assert_eq!(r.issues[0].kind, "unclosed");
        let r = rich("x</i>");
        assert_eq!(r.html, "x&lt;/i&gt;");
        assert_eq!(r.issues[0].kind, "stray-close");
        let r = rich("<b onclick=\"x()\">no</b>");
        assert!(r.html.starts_with("&lt;b onclick"));
        assert_eq!(r.issues[0].kind, "attribute");
        assert_eq!(rich("<b/>").issues[0].kind, "self-closing");
    }

    #[test]
    fn code_shows_its_inside_as_written() {
        let r = rich("Use <code><br> or <b></code> here");
        assert_eq!(r.html, "Use <code>&lt;br&gt; or &lt;b&gt;</code> here");
        assert!(r.issues.is_empty());
        // As the element itself, all of it is text.
        let r = render_content("<b>x</b>\ny", TextMode::Literal, "code");
        assert_eq!(r.html, "&lt;b&gt;x&lt;/b&gt;<br />y");
    }

    #[test]
    fn ruby_and_nesting() {
        let r = rich("<ruby>漢字<rt>かんじ</rt></ruby>を<strong><em>強く</em></strong>");
        assert_eq!(r.html, "<ruby>漢字<rt>かんじ</rt></ruby>を<strong><em>強く</em></strong>");
        let r = rich("<a href=\"/a\">x <a href=\"/b\">y</a></a>");
        assert!(r.issues.iter().any(|i| i.kind == "nested-link"));
        let r = render_content("<a href=\"/b\">y</a>", TextMode::Rich, "a");
        assert_eq!(r.issues[0].kind, "nested-link");
    }

    #[test]
    fn plain_text_drops_markup() {
        assert_eq!(plain_text("Hello <b>world</b>\nagain &amp; <i>x"), "Hello world again &amp; <i>x");
    }

    #[test]
    fn only_html_white_space_collapses() {
        assert_eq!(collapse_html_whitespace("  a \n\t b  "), "a b");
        // The ideographic space and NBSP are text, not layout.
        assert_eq!(collapse_html_whitespace("全角\u{3000}空白\u{a0}x"), "全角\u{3000}空白\u{a0}x");
    }

    #[test]
    fn modes_by_tag() {
        assert_eq!(text_mode("p", false), TextMode::Rich);
        assert_eq!(text_mode("code", false), TextMode::Literal);
        assert_eq!(text_mode("p", true), TextMode::Raw);
        for raw in ["script", "style", "title", "textarea", "option", "pre"] {
            assert_eq!(text_mode(raw, false), TextMode::Raw, "{raw}");
        }
    }
}
