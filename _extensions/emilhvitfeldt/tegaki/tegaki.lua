-- Base64 encoder (pure Lua)
local b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local function base64_encode(data)
  return ((data:gsub('.', function(x)
    local r, b = '', x:byte()
    for i = 8, 1, -1 do r = r .. (b % 2^i - b % 2^(i-1) > 0 and '1' or '0') end
    return r
  end) .. '0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
    if (#x < 6) then return '' end
    local c = 0
    for i = 1, 6 do c = c + (x:sub(i, i) == '1' and 2^(6 - i) or 0) end
    return b64chars:sub(c + 1, c + 1)
  end) .. ({ '', '==', '=' })[#data % 3 + 1])
end

-- Safely quote a string for shell single-quote context
local function shell_quote(s)
  return "'" .. s:gsub("'", "'\\''") .. "'"
end

-- Create a unique temp directory atomically
local function make_tmp_dir()
  local handle = io.popen('mktemp -d')
  local path = handle:read('*a'):gsub('%s+$', '')
  handle:close()
  return path ~= '' and path or nil
end

local function inject_user_font(zip_path)
  local tmp = make_tmp_dir()
  if not tmp then
    quarto.log.warning('tegaki: could not create temp directory for ' .. zip_path)
    return
  end

  local ret = os.execute('unzip -o ' .. shell_quote(zip_path) .. ' -d ' .. shell_quote(tmp) .. ' > /dev/null 2>&1')
  if not ret then
    quarto.log.warning('tegaki: failed to unzip ' .. zip_path)
    os.execute('rm -rf ' .. shell_quote(tmp))
    return
  end

  -- Find bundle.ts
  local handle = io.popen('find ' .. shell_quote(tmp) .. ' -name "bundle.ts" | head -1')
  local bundle_ts_path = handle:read('*a'):gsub('%s+$', '')
  handle:close()

  if bundle_ts_path == '' then
    quarto.log.warning('tegaki: could not find bundle.ts in ' .. zip_path)
    os.execute('rm -rf ' .. shell_quote(tmp))
    return
  end

  local font_dir = bundle_ts_path:match('^(.*)/[^/]+$')

  -- Read bundle.ts and extract metadata
  local f = io.open(bundle_ts_path)
  if not f then
    quarto.log.warning('tegaki: could not read bundle.ts in ' .. zip_path)
    os.execute('rm -rf ' .. shell_quote(tmp))
    return
  end
  local bundle_ts = f:read('*a')
  f:close()

  local family    = bundle_ts:match("family:%s*'([^']+)'")
  local units     = tonumber(bundle_ts:match('unitsPerEm:%s*(%d+)')) or 1000
  local ascender  = tonumber(bundle_ts:match('ascender:%s*(%d+)')) or 800
  -- descender may be negative; allow optional whitespace between sign and digits
  local desc_str  = bundle_ts:match('descender:%s*(-?%s*%d+)')
  local descender = desc_str and tonumber((desc_str:gsub('%s', ''))) or -200
  local line_cap  = bundle_ts:match("lineCap:%s*'([^']+)'") or 'round'

  if not family then
    quarto.log.warning('tegaki: could not parse family from bundle.ts in ' .. zip_path)
    os.execute('rm -rf ' .. shell_quote(tmp))
    return
  end

  -- Find the TTF file
  local ttf_handle = io.popen('find ' .. shell_quote(font_dir) .. ' -name "*.ttf" | head -1')
  local ttf_path = ttf_handle:read('*a'):gsub('%s+$', '')
  ttf_handle:close()

  if ttf_path == '' then
    quarto.log.warning('tegaki: could not find .ttf in ' .. zip_path)
    os.execute('rm -rf ' .. shell_quote(tmp))
    return
  end

  local ttf_f = io.open(ttf_path, 'rb')
  if not ttf_f then
    quarto.log.warning('tegaki: could not read .ttf in ' .. zip_path)
    os.execute('rm -rf ' .. shell_quote(tmp))
    return
  end
  local ttf_data = ttf_f:read('*a')
  ttf_f:close()
  local font_url = 'data:font/truetype;base64,' .. base64_encode(ttf_data)
  local font_face_css = "@font-face { font-family: '" .. family .. "'; src: url(" .. font_url .. "); }"

  -- Find glyphData.json
  local glyph_handle = io.popen('find ' .. shell_quote(font_dir) .. ' -name "glyphData.json" | head -1')
  local glyph_path = glyph_handle:read('*a'):gsub('%s+$', '')
  glyph_handle:close()

  if glyph_path == '' then
    quarto.log.warning('tegaki: could not find glyphData.json in ' .. zip_path)
    os.execute('rm -rf ' .. shell_quote(tmp))
    return
  end

  local glyph_f = io.open(glyph_path)
  if not glyph_f then
    quarto.log.warning('tegaki: could not read glyphData.json in ' .. zip_path)
    os.execute('rm -rf ' .. shell_quote(tmp))
    return
  end
  local glyph_json = glyph_f:read('*a')
  glyph_f:close()

  -- Inject inline script that registers the font in window.__tegakiUserFonts
  local script = string.format(
    '<script>\nwindow.__tegakiUserFonts = window.__tegakiUserFonts || {};\n' ..
    'window.__tegakiUserFonts[%q] = {\n' ..
    '  family: %q,\n  lineCap: %q,\n  fontUrl: %q,\n  fontFaceCSS: %q,\n' ..
    '  unitsPerEm: %d,\n  ascender: %d,\n  descender: %d,\n  glyphData: %s\n};\n</script>',
    family, family, line_cap, font_url, font_face_css,
    units, ascender, descender, glyph_json
  )

  quarto.doc.include_text('in-header', script)
  os.execute('rm -rf ' .. shell_quote(tmp))
end

local function is_revealjs()
  return quarto.doc.is_format("revealjs")
end

local function add_tegaki_dependency(format)
  local script_file = format == "revealjs" and "tegaki-revealjs.js" or "tegaki-html.js"
  quarto.doc.add_html_dependency({
    name = "tegaki",
    version = "0.11.1",
    scripts = {
      { path = script_file, attribs = { type = "module" } }
    },
    resources = {
      "core-I9K3LqxK.mjs",
      "index.mjs",
      "caveat.mjs",
      "italianno.mjs",
      "parisienne.mjs",
      "tangerine.mjs",
      "caveat.ttf",
      "italianno.ttf",
      "parisienne.ttf",
      "tangerine.ttf",
    }
  })
end

local dependency_added = false

function Meta(meta)
  local user_fonts = meta["tegaki-fonts"]
  if user_fonts then
    -- Ensure the JS dependency is loaded even if there are no .tegaki spans
    if not dependency_added then
      local format = is_revealjs() and "revealjs" or "html"
      add_tegaki_dependency(format)
      dependency_added = true
    end
    for _, font_val in ipairs(user_fonts) do
      local zip_path = pandoc.utils.stringify(font_val)
      inject_user_font(zip_path)
    end
  end
  return meta
end

function Span(el)
  if not el.classes:includes("tegaki") then
    return nil
  end

  if not dependency_added then
    local format = is_revealjs() and "revealjs" or "html"
    add_tegaki_dependency(format)
    dependency_added = true
  end

  -- Build a span with data attributes for the JS to pick up
  local text = pandoc.utils.stringify(el)
  local font = el.attributes["font"] or el.attributes["data-font"] or ""
  local size = el.attributes["size"] or ""
  local duration = el.attributes["duration"] or ""

  local span = pandoc.RawInline("html",
    '<span class="tegaki-span' ..
    (el.classes:includes("fragment") and " fragment" or "") ..
    '"' ..
    ' data-tegaki-text="' .. text:gsub('"', '&quot;') .. '"' ..
    (font ~= "" and (' data-tegaki-font="' .. font .. '"') or "") ..
    (size ~= "" and (' data-tegaki-size="' .. size .. '"') or "") ..
    (duration ~= "" and (' data-tegaki-duration="' .. duration .. '"') or "") ..
    '></span>'
  )

  return span
end
