-- checklist-fragments.lua
-- Quarto RevealJS extension: animated checkbox fragments.
--
-- Usage inside a ::: checklist div:
--
--   - [/]  green check      (done)
--   - [-]  red cross        (didn't happen)
--   - [~]  amber spinner    (in progress)
--   - [>]  gray chevron     (skipped)
--   - [!]  orange bang      (blocked)
--   - [?]  purple question  (unknown)
--   - [=]  blue bars        (partial)
--   - [*]  gold star        (priority)
--
-- Append a number to control reveal order:
--   - [/3]  check, revealed 3rd
--   - [-1]  cross, revealed 1st
--
-- Items with the same number reveal simultaneously.
-- Items without a number are auto-sequenced by document order.

-- Inject the companion CSS once per document
function Meta(meta)
  if quarto.doc.is_format("revealjs") then
    local dir = pandoc.path.directory(PANDOC_SCRIPT_FILE)
    quarto.doc.add_html_dependency({
      name        = "checklist-fragments",
      version     = "0.1.0",
      stylesheets = { pandoc.path.join({dir, "checklist-fragments.css"}) },
    })
  end
  return meta
end

-- SVG contents per marker type
local TYPES = {
  ["/"] = {
    class = "cb-mark",
    svg   = '<line class="cb-path cb-p1" x1="4" y1="11" x2="9" y2="16"/>'
          .. '<line class="cb-path cb-p2" x1="9" y1="16" x2="18" y2="6"/>',
  },
  ["-"] = {
    class = "cb-cross",
    svg   = '<line class="cb-line" x1="5" y1="5" x2="17" y2="17"/>'
          .. '<line class="cb-line" x1="17" y1="5" x2="5" y2="17"/>',
  },
  ["~"] = {
    class = "cb-spin",
    svg   = '<circle class="cb-arc" cx="11" cy="11" r="7"/>',
  },
  [">"] = {
    class = "cb-skip",
    svg   = '<line class="cb-chev cb-chev-1" x1="6" y1="6" x2="16" y2="11"/>'
          .. '<line class="cb-chev cb-chev-2" x1="16" y1="11" x2="6" y2="16"/>',
  },
  ["!"] = {
    class = "cb-block",
    svg   = '<line class="cb-excl-line" x1="11" y1="5" x2="11" y2="14"/>'
          .. '<circle class="cb-excl-dot" cx="11" cy="18" r="1.5"/>',
  },
  ["?"] = {
    class = "cb-unknown",
    svg   = '<path class="cb-qmark" d="M7,8.5 C7,4 15,4 15,9 C15,13 12,12 11,15"/>'
          .. '<circle class="cb-qdot" cx="11" cy="18.5" r="1.5"/>',
  },
  ["="] = {
    class = "cb-partial",
    svg   = '<line class="cb-bar cb-bar-1" x1="5" y1="9"  x2="17" y2="9"/>'
          .. '<line class="cb-bar cb-bar-2" x1="5" y1="13" x2="17" y2="13"/>',
  },
  ["*"] = {
    class = "cb-star",
    svg   = '<path class="cb-star-path"'
          .. ' d="M11,2 L13.1,8.2 L19.6,8.2 L14.3,12.1 L16.3,18.3'
          .. '    L11,14.5 L5.7,18.3 L7.7,12.1 L2.4,8.2 L8.9,8.2 Z"/>',
  },
}

-- Build the checkbox HTML, injecting data-fragment-index when provided
local function cb_wrap(t, idx)
  local idx_attr = idx and (' data-fragment-index="' .. idx .. '"') or ''
  return '<span class="task-cb">'
    .. '<svg viewBox="0 0 22 22">'
    .. '<rect x="1" y="1" width="20" height="20" rx="3" class="cb-border"/>'
    .. '</svg>'
    .. '<span class="' .. t.class .. ' fragment"' .. idx_attr .. '>'
    .. '<svg viewBox="0 0 22 22">' .. t.svg .. '</svg>'
    .. '</span></span>'
end

-- Parse "[/]"  → "/", nil
-- Parse "[/3]" → "/", 3
local function parse_marker(str)
  local key, digits = str:match("^%[([%-/~>!?=*])(%d*)%]$")
  if not key then return nil, nil end
  return key, (digits ~= "" and tonumber(digits) or nil)
end

local function process_item(item)
  local block = item[1]
  if not block then return nil end
  if block.t ~= "Plain" and block.t ~= "Para" then return nil end

  local inlines = block.content
  local first = inlines[1]
  if not first or first.t ~= "Str" then return nil end

  local key, idx = parse_marker(first.text)
  local t = key and TYPES[key]
  if not t then return nil end

  -- Collect label inlines, skipping the marker and its trailing space
  local rest = {}
  local start = 2
  if inlines[start] and inlines[start].t == "Space" then
    start = start + 1
  end
  for i = start, #inlines do
    rest[#rest + 1] = inlines[i]
  end

  local label = pandoc.utils.stringify(pandoc.Span(rest))
  return '  <li>' .. cb_wrap(t, idx) .. ' ' .. label .. '</li>'
end

function Div(el)
  if not el.classes:includes("checklist") then return nil end

  local parts = { '<ul class="checklist">' }
  for _, block in ipairs(el.content) do
    if block.t == "BulletList" then
      for _, item in ipairs(block.content) do
        local html = process_item(item)
        if html then parts[#parts + 1] = html end
      end
    end
  end
  parts[#parts + 1] = '</ul>'
  return pandoc.RawBlock("html", table.concat(parts, "\n"))
end
