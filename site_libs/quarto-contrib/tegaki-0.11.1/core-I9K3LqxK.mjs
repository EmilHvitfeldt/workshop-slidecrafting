//#region src/lib/effects.ts
const defaultEffects = { pressureWidth: true };
const knownEffects = new Set([
	"glow",
	"wobble",
	"pressureWidth",
	"taper",
	"gradient"
]);
/**
* Normalizes an effects record into a sorted array of resolved effects.
* Known keys infer the effect name; custom keys read it from the `effect` field.
* Boolean `true` becomes an empty config. `false`/absent entries are skipped.
*/
function resolveEffects(effects) {
	const merged = {
		...defaultEffects,
		...effects
	};
	const result = [];
	for (const [key, value] of Object.entries(merged)) {
		if (value === false || value == null) continue;
		let effectName;
		let config;
		let order;
		if (value === true) {
			effectName = knownEffects.has(key) ? key : void 0;
			if (!effectName) continue;
			config = {};
			order = 0;
		} else {
			if (value.enabled === false) continue;
			effectName = value.effect ?? (knownEffects.has(key) ? key : void 0);
			if (!effectName) continue;
			const { effect: _, order: o, enabled: __, ...rest } = value;
			config = rest;
			order = o ?? 0;
		}
		result.push({
			effect: effectName,
			order,
			config
		});
	}
	result.sort((a, b) => a.order - b.order);
	return result;
}
/** Check if a specific effect is active. */
function findEffect(effects, name) {
	return effects.find((e) => e.effect === name);
}
/** Get all instances of a specific effect (for duplicates). */
function findEffects(effects, name) {
	return effects.filter((e) => e.effect === name);
}
//#endregion
//#region src/lib/utils.ts
const segmenter = new Intl.Segmenter(void 0, { granularity: "grapheme" });
/** Resolve a CSSLength to pixels. Plain numbers are px, `"Nem"` is N * fontSize. */
function resolveCSSLength(value, fontSize) {
	if (typeof value === "number") return value;
	return parseFloat(value) * fontSize;
}
function graphemes(text) {
	return Array.from(segmenter.segment(text), (s) => s.segment);
}
function coerceToString(value) {
	if (value == null || typeof value === "boolean") return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "bigint") return String(value);
	if (Array.isArray(value)) return value.map(coerceToString).join("");
	return "";
}
//#endregion
//#region src/lib/drawGlyph.ts
function parseColor(color) {
	const h = color.replace("#", "");
	if (h.length === 3) return [
		parseInt(h[0] + h[0], 16),
		parseInt(h[1] + h[1], 16),
		parseInt(h[2] + h[2], 16),
		1
	];
	if (h.length === 4) return [
		parseInt(h[0] + h[0], 16),
		parseInt(h[1] + h[1], 16),
		parseInt(h[2] + h[2], 16),
		parseInt(h[3] + h[3], 16) / 255
	];
	if (h.length === 8) return [
		parseInt(h.slice(0, 2), 16),
		parseInt(h.slice(2, 4), 16),
		parseInt(h.slice(4, 6), 16),
		parseInt(h.slice(6, 8), 16) / 255
	];
	return [
		parseInt(h.slice(0, 2), 16),
		parseInt(h.slice(2, 4), 16),
		parseInt(h.slice(4, 6), 16),
		1
	];
}
function lerpColor(a, b, t) {
	const r = Math.round(a[0] + (b[0] - a[0]) * t);
	const g = Math.round(a[1] + (b[1] - a[1]) * t);
	const bl = Math.round(a[2] + (b[2] - a[2]) * t);
	const al = a[3] + (b[3] - a[3]) * t;
	if (al >= 1) return `rgb(${r},${g},${bl})`;
	return `rgba(${r},${g},${bl},${al.toFixed(3)})`;
}
function gradientColor(progress, colors, seed) {
	if (colors.length === 0) return "#000";
	if (colors.length === 1) return colors[0];
	const scaledT = ((progress + seed * .1) % 1 + 1) % 1 * (colors.length - 1);
	const i = Math.min(Math.floor(scaledT), colors.length - 2);
	const frac = scaledT - i;
	return lerpColor(parseColor(colors[i]), parseColor(colors[i + 1]), frac);
}
function rainbowColor(progress, saturation, lightness, seed) {
	return `hsl(${(progress * 360 + seed * 137.5) % 360}, ${saturation}%, ${lightness}%)`;
}
function hash(x) {
	let h = x * 2654435761 | 0;
	h = (h >>> 16 ^ h) * 73244475;
	h = (h >>> 16 ^ h) * 73244475;
	h = h >>> 16 ^ h;
	return (h & 2147483647) / 2147483647;
}
function noise1d(x, seed) {
	const i = Math.floor(x);
	const f = x - i;
	const t = f * f * (3 - 2 * f);
	return hash(i + seed * 7919) * (1 - t) + hash(i + 1 + seed * 7919) * t;
}
/**
* Draw a single glyph's strokes onto a canvas context, animated up to `localTime`.
* `localTime` is seconds relative to this glyph's start (0 = glyph begins).
*/
function drawGlyph(ctx, glyph, pos, localTime, lineCap, color, effects = [], seed = 0, segmentSize) {
	const scale = pos.fontSize / pos.unitsPerEm;
	const ox = pos.x;
	const oy = pos.y;
	const glowEffects = findEffects(effects, "glow");
	const wobbleEffect = findEffect(effects, "wobble");
	const pressureEffect = findEffect(effects, "pressureWidth");
	const taperEffect = findEffect(effects, "taper");
	const gradientEffect = findEffect(effects, "gradient");
	const pressureAmount = pressureEffect ? Math.max(0, Math.min(pressureEffect.config.strength ?? 1, 1)) : 0;
	const wobbleAmplitude = wobbleEffect ? wobbleEffect.config.amplitude ?? 1.5 : 0;
	const wobbleFrequency = wobbleEffect ? wobbleEffect.config.frequency ?? 8 : 0;
	const wobbleMode = wobbleEffect?.config.mode ?? "sine";
	const taperStart = taperEffect ? Math.max(0, Math.min(taperEffect.config.startLength ?? .15, 1)) : 0;
	const taperEnd = taperEffect ? Math.max(0, Math.min(taperEffect.config.endLength ?? .15, 1)) : 0;
	const gradientColors = gradientEffect?.config.colors;
	const isRainbow = gradientColors === "rainbow";
	const gradientColorStops = Array.isArray(gradientColors) ? gradientColors : void 0;
	const gradientSaturation = gradientEffect?.config.saturation ?? 80;
	const gradientLightness = gradientEffect?.config.lightness ?? 55;
	const wobbleX = (x, y, idx) => {
		if (!wobbleEffect) return x;
		if (wobbleMode === "noise") return x + wobbleAmplitude * (noise1d(y * .1 + idx * .7, seed) * 2 - 1);
		return x + wobbleAmplitude * Math.sin(wobbleFrequency * (y * .01 + idx * .7) + seed);
	};
	const wobbleY = (x, y, idx) => {
		if (!wobbleEffect) return y;
		if (wobbleMode === "noise") return y + wobbleAmplitude * (noise1d(x * .1 + idx * .5, seed * 1.3 + 1e3) * 2 - 1);
		return y + wobbleAmplitude * Math.cos(wobbleFrequency * (x * .01 + idx * .5) + seed * 1.3);
	};
	const px = (x) => ox + x * scale;
	const py = (y) => oy + (y + pos.ascender) * scale;
	const colorAt = (progress) => {
		if (isRainbow) return rainbowColor(progress, gradientSaturation, gradientLightness, seed);
		if (gradientColorStops) return gradientColor(progress, gradientColorStops, seed);
		return color;
	};
	const hasGradient = !!gradientEffect;
	const taperMultiplier = (progress) => {
		let m = 1;
		if (taperStart > 0 && progress < taperStart) m = Math.min(m, progress / taperStart);
		if (taperEnd > 0 && progress > 1 - taperEnd) m = Math.min(m, (1 - progress) / taperEnd);
		return m;
	};
	for (const stroke of glyph.s) {
		if (localTime < stroke.d) continue;
		const elapsed = localTime - stroke.d;
		const progress = Math.min(elapsed / stroke.a, 1);
		const pts = stroke.p;
		if (pts.length === 0) continue;
		const avgWidth = pts.reduce((s, p) => s + p[2], 0) / pts.length;
		const baseLineWidth = Math.max(avgWidth, .5) * scale;
		if (pts.length === 1) {
			if (progress <= 0) continue;
			const p = pts[0];
			const dotX = px(wobbleX(p[0], p[1], 0));
			const dotY = py(wobbleY(p[0], p[1], 0));
			let dotWidth = baseLineWidth + (Math.max(p[2], .5) * scale - baseLineWidth) * pressureAmount;
			dotWidth *= taperMultiplier(.5);
			for (const glow of glowEffects) {
				ctx.save();
				ctx.shadowBlur = resolveCSSLength(glow.config.radius ?? 8, pos.fontSize);
				ctx.shadowColor = glow.config.color ?? color;
				ctx.shadowOffsetX = (glow.config.offsetX ?? 0) * scale;
				ctx.shadowOffsetY = (glow.config.offsetY ?? 0) * scale;
				ctx.fillStyle = glow.config.color ?? color;
				ctx.beginPath();
				if (lineCap === "round") ctx.arc(dotX, dotY, dotWidth / 2, 0, Math.PI * 2);
				else ctx.rect(dotX - dotWidth / 2, dotY - dotWidth / 2, dotWidth, dotWidth);
				ctx.fill();
				ctx.restore();
			}
			ctx.fillStyle = colorAt(0);
			ctx.beginPath();
			if (lineCap === "round") {
				ctx.arc(dotX, dotY, dotWidth / 2, 0, Math.PI * 2);
				ctx.fill();
			} else ctx.fillRect(dotX - dotWidth / 2, dotY - dotWidth / 2, dotWidth, dotWidth);
			continue;
		}
		let totalLen = 0;
		for (let j = 1; j < pts.length; j++) {
			const dx = pts[j][0] - pts[j - 1][0];
			const dy = pts[j][1] - pts[j - 1][1];
			totalLen += Math.sqrt(dx * dx + dy * dy);
		}
		const drawLen = totalLen * progress;
		if (drawLen <= 0) continue;
		const segments = [];
		let accumulated = 0;
		for (let j = 1; j < pts.length; j++) {
			const prev = pts[j - 1];
			const cur = pts[j];
			const dx = cur[0] - prev[0];
			const dy = cur[1] - prev[1];
			const segLen = Math.sqrt(dx * dx + dy * dy);
			if (accumulated + segLen <= drawLen) {
				segments.push({
					x0: px(wobbleX(prev[0], prev[1], j - 1)),
					y0: py(wobbleY(prev[0], prev[1], j - 1)),
					x1: px(wobbleX(cur[0], cur[1], j)),
					y1: py(wobbleY(cur[0], cur[1], j)),
					width0: prev[2],
					width1: cur[2],
					segProgress: (accumulated + segLen / 2) / totalLen
				});
				accumulated += segLen;
			} else {
				const remaining = drawLen - accumulated;
				const frac = segLen > 0 ? remaining / segLen : 0;
				const ix = prev[0] + dx * frac;
				const iy = prev[1] + dy * frac;
				const iw = prev[2] + (cur[2] - prev[2]) * frac;
				segments.push({
					x0: px(wobbleX(prev[0], prev[1], j - 1)),
					y0: py(wobbleY(prev[0], prev[1], j - 1)),
					x1: px(wobbleX(ix, iy, j)),
					y1: py(wobbleY(ix, iy, j)),
					width0: prev[2],
					width1: iw,
					segProgress: (accumulated + remaining / 2) / totalLen
				});
				break;
			}
		}
		if (segments.length === 0) continue;
		const coarseSegments = segments.slice();
		const resolvedSegmentSize = segmentSize ?? (pressureAmount > 0 || hasGradient || !!wobbleEffect || !!taperEffect ? 2 : void 0);
		if (resolvedSegmentSize != null) {
			const maxSegLen = resolvedSegmentSize * scale;
			const subdivided = [];
			for (const seg of segments) {
				const dx = seg.x1 - seg.x0;
				const dy = seg.y1 - seg.y0;
				const len = Math.sqrt(dx * dx + dy * dy);
				const count = Math.max(1, Math.ceil(len / maxSegLen));
				for (let k = 0; k < count; k++) {
					const t0 = k / count;
					const t1 = (k + 1) / count;
					subdivided.push({
						x0: seg.x0 + dx * t0,
						y0: seg.y0 + dy * t0,
						x1: seg.x0 + dx * t1,
						y1: seg.y0 + dy * t1,
						width0: seg.width0 + (seg.width1 - seg.width0) * t0,
						width1: seg.width0 + (seg.width1 - seg.width0) * t1,
						segProgress: seg.segProgress
					});
				}
			}
			for (let k = 0; k < subdivided.length; k++) subdivided[k].segProgress = subdivided.length > 1 ? k / (subdivided.length - 1) : 0;
			segments.length = 0;
			segments.push(...subdivided);
		}
		const segWidth = (seg) => {
			const perPoint = (seg.width0 + seg.width1) / 2 * scale;
			return Math.max(baseLineWidth + (perPoint - baseLineWidth) * pressureAmount, .5 * scale) * taperMultiplier(seg.segProgress);
		};
		const needsPerSegment = pressureAmount > 0 || taperEffect;
		const drawStrokePath = () => {
			if (needsPerSegment) for (const seg of segments) {
				ctx.lineWidth = segWidth(seg);
				ctx.beginPath();
				ctx.moveTo(seg.x0, seg.y0);
				ctx.lineTo(seg.x1, seg.y1);
				ctx.stroke();
			}
			else {
				ctx.lineWidth = baseLineWidth;
				ctx.beginPath();
				ctx.moveTo(segments[0].x0, segments[0].y0);
				for (const seg of segments) ctx.lineTo(seg.x1, seg.y1);
				ctx.stroke();
			}
		};
		const drawGradientPath = () => {
			for (const seg of segments) {
				ctx.strokeStyle = colorAt(seg.segProgress);
				if (needsPerSegment) ctx.lineWidth = segWidth(seg);
				ctx.beginPath();
				ctx.moveTo(seg.x0, seg.y0);
				ctx.lineTo(seg.x1, seg.y1);
				ctx.stroke();
			}
		};
		ctx.lineCap = lineCap;
		ctx.lineJoin = "round";
		for (const glow of glowEffects) {
			ctx.save();
			ctx.shadowBlur = resolveCSSLength(glow.config.radius ?? 8, pos.fontSize);
			ctx.shadowColor = glow.config.color ?? color;
			ctx.shadowOffsetX = (glow.config.offsetX ?? 0) * scale;
			ctx.shadowOffsetY = (glow.config.offsetY ?? 0) * scale;
			ctx.strokeStyle = glow.config.color ?? color;
			ctx.lineWidth = baseLineWidth;
			ctx.beginPath();
			ctx.moveTo(coarseSegments[0].x0, coarseSegments[0].y0);
			for (const seg of coarseSegments) ctx.lineTo(seg.x1, seg.y1);
			ctx.stroke();
			ctx.restore();
		}
		if (hasGradient) drawGradientPath();
		else {
			ctx.strokeStyle = color;
			drawStrokePath();
		}
	}
}
//#endregion
//#region src/lib/font.ts
const fontFaceCache = /* @__PURE__ */ new Map();
/**
* Ensures the bundle's font face is loaded and available for rendering.
* Resolves immediately if the font is already loaded.
*/
async function ensureFontFace(bundle) {
	await ensureFont(bundle.family, bundle.fontUrl);
}
function ensureFont(family, url) {
	if (typeof document === "undefined") return Promise.resolve();
	for (const face of document.fonts) if (face.family === family) {
		if (face.status === "loaded") return null;
		if (face.status === "loading") return face.loaded.then(() => {});
	}
	let cached = fontFaceCache.get(url);
	if (!cached) {
		cached = new FontFace(family, `url(${url})`, { featureSettings: "'calt' 0, 'liga' 0" }).load().then((loaded) => {
			document.fonts.add(loaded);
		});
		fontFaceCache.set(url, cached);
	}
	return cached;
}
//#endregion
//#region src/lib/textLayout.ts
function computeTextLayout(elOrText, fontSize, fontFamily, lineHeight, maxWidth) {
	if (typeof elOrText === "string") return measureWithTempElement(elOrText, fontFamily, fontSize, lineHeight, maxWidth);
	return measureElement(elOrText, fontSize);
}
function measureElement(el, fontSize) {
	const textNode = el.firstChild;
	if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return {
		lines: [],
		charOffsets: [],
		charWidths: []
	};
	const chars = graphemes(textNode.textContent ?? "");
	if (!chars.length) return {
		lines: [],
		charOffsets: [],
		charWidths: []
	};
	const range = document.createRange();
	const charOffsets = [];
	const charWidths = [];
	const lines = [];
	let currentLine = [];
	let prevTop = -Infinity;
	let lineStartX = 0;
	let utf16Offset = 0;
	for (let i = 0; i < chars.length; i++) {
		const char = chars[i];
		if (char === "\n") {
			charOffsets.push(0);
			charWidths.push(0);
			currentLine.push(i);
			lines.push(currentLine);
			currentLine = [];
			prevTop = -Infinity;
			utf16Offset += char.length;
			continue;
		}
		range.setStart(textNode, utf16Offset);
		range.setEnd(textNode, utf16Offset + char.length);
		const rects = range.getClientRects();
		utf16Offset += char.length;
		if (rects.length === 0) {
			charOffsets.push(0);
			charWidths.push(0);
			currentLine.push(i);
			continue;
		}
		const rect = rects[0];
		if (currentLine.length > 0 && rect.top - prevTop > fontSize * .25) {
			lines.push(currentLine);
			currentLine = [];
		}
		if (currentLine.length === 0) {
			prevTop = rect.top;
			lineStartX = rect.left;
		}
		charOffsets.push((rect.left - lineStartX) / fontSize);
		charWidths.push(rect.width / fontSize);
		currentLine.push(i);
	}
	if (currentLine.length > 0) lines.push(currentLine);
	return {
		lines,
		charOffsets,
		charWidths
	};
}
function measureWithTempElement(text, fontFamily, fontSize, lineHeight, maxWidth) {
	const el = document.createElement("div");
	el.style.position = "absolute";
	el.style.left = "-9999px";
	el.style.top = "-9999px";
	el.style.visibility = "hidden";
	el.style.fontFamily = fontFamily;
	el.style.fontSize = `${fontSize}px`;
	el.style.lineHeight = `${lineHeight}px`;
	el.style.whiteSpace = "pre-wrap";
	el.style.overflowWrap = "break-word";
	el.style.width = `${maxWidth}px`;
	el.textContent = text;
	document.body.appendChild(el);
	const result = measureElement(el, fontSize);
	document.body.removeChild(el);
	return result;
}
//#endregion
//#region src/lib/timeline.ts
const DEFAULTS = {
	glyphGap: .1,
	wordGap: .15,
	lineGap: .3,
	unknownDuration: .2
};
function computeTimeline(text, font, config) {
	const glyphGap = config?.glyphGap ?? DEFAULTS.glyphGap;
	const wordGap = config?.wordGap ?? DEFAULTS.wordGap;
	const lineGap = config?.lineGap ?? DEFAULTS.lineGap;
	const unknownDuration = config?.unknownDuration ?? DEFAULTS.unknownDuration;
	const chars = graphemes(text);
	const entries = [];
	let offset = 0;
	for (const char of chars) {
		const glyph = font.glyphData[char];
		const hasGlyph = !!glyph;
		const duration = hasGlyph ? glyph.t ?? 1 : unknownDuration;
		entries.push({
			char,
			offset,
			duration,
			hasGlyph
		});
		offset += duration;
		if (char === "\n") offset += lineGap;
		else if (char === " ") offset += wordGap;
		else offset += glyphGap;
	}
	if (entries.length > 0) {
		const lastChar = chars[chars.length - 1];
		offset -= lastChar === "\n" ? lineGap : lastChar === " " ? wordGap : glyphGap;
	}
	return {
		entries,
		totalDuration: Math.max(0, offset)
	};
}
//#endregion
//#region src/core/bundle-registry.ts
const bundles = /* @__PURE__ */ new Map();
/** Register a font bundle so it can be referenced by family name. */
function registerBundle(bundle) {
	bundles.set(bundle.family, bundle);
}
/** Look up a registered bundle by family name. */
function getBundle(family) {
	return bundles.get(family);
}
function resolveBundle(font) {
	if (typeof font === "string") {
		const bundle = getBundle(font);
		if (!bundle) throw new Error(`TegakiEngine: no bundle registered for "${font}". Call TegakiEngine.registerBundle() first.`);
		return bundle;
	}
	return font;
}
//#endregion
//#region src/core/createBundle.ts
/**
* Creates a {@link TegakiBundle} from its constituent parts.
*
* Useful when loading font data from a CDN or other source where the
* pre-built bundle modules aren't available:
*
* ```js
* const glyphData = await fetch('.../glyphData.json').then(r => r.json());
* const bundle = createBundle({
*   family: 'Caveat',
*   fontUrl: '.../caveat.ttf',
*   glyphData,
* });
* ```
*/
function createBundle({ family, fontUrl, glyphData, lineCap = "round", unitsPerEm = 1e3, ascender = 800, descender = -200 }) {
	return {
		family,
		lineCap,
		fontUrl,
		fontFaceCSS: `@font-face { font-family: '${family}'; src: url(${fontUrl}); }`,
		unitsPerEm,
		ascender,
		descender,
		glyphData
	};
}
//#endregion
//#region src/lib/css-properties.ts
const CSS_TIME = "--tegaki-time";
const CSS_PROGRESS = "--tegaki-progress";
const CSS_DURATION = "--tegaki-duration";
const PADDING_H_EM = .2;
const MIN_LINE_HEIGHT_EM = 1.8;
const MIN_PADDING_V_EM = .2;
let cssPropertiesRegistered = false;
function registerCssProperties() {
	if (cssPropertiesRegistered) return;
	cssPropertiesRegistered = true;
	if (typeof CSS !== "undefined" && "registerProperty" in CSS) for (const prop of [
		CSS_TIME,
		CSS_PROGRESS,
		CSS_DURATION
	]) try {
		CSS.registerProperty({
			name: prop,
			syntax: "<number>",
			inherits: true,
			initialValue: "0"
		});
	} catch {}
}
//#endregion
//#region src/lib/drawFallbackGlyph.ts
/**
* Draw a fallback glyph (plain text) with applicable effects (glow, gradient, wobble).
*/
function drawFallbackGlyph(ctx, char, x, baseline, fontSize, fontFamily, color, effects = [], seed = 0) {
	const glowEffects = findEffects(effects, "glow");
	const wobbleEffect = findEffect(effects, "wobble");
	const gradientEffect = findEffect(effects, "gradient");
	let dx = 0;
	let dy = 0;
	if (wobbleEffect) {
		const amplitude = (wobbleEffect.config.amplitude ?? 1.5) * (fontSize / 100);
		const frequency = wobbleEffect.config.frequency ?? 8;
		dx = amplitude * Math.sin(frequency * (baseline * .01) + seed);
		dy = amplitude * Math.cos(frequency * (x * .01) + seed * 1.3);
	}
	const drawX = x + dx;
	const drawY = baseline + dy;
	let fillColor = color;
	if (gradientEffect) {
		const colors = gradientEffect.config.colors;
		if (colors === "rainbow") {
			const saturation = gradientEffect.config.saturation ?? 80;
			const lightness = gradientEffect.config.lightness ?? 55;
			fillColor = `hsl(${seed * 137.5 % 360}, ${saturation}%, ${lightness}%)`;
		} else if (Array.isArray(colors) && colors.length > 0) fillColor = colors[Math.floor(seed) % colors.length];
	}
	ctx.save();
	ctx.font = `${fontSize}px ${fontFamily}`;
	ctx.textBaseline = "alphabetic";
	for (const glow of glowEffects) {
		ctx.save();
		ctx.shadowBlur = resolveCSSLength(glow.config.radius ?? 8, fontSize);
		ctx.shadowColor = glow.config.color ?? color;
		ctx.shadowOffsetX = glow.config.offsetX ?? 0;
		ctx.shadowOffsetY = glow.config.offsetY ?? 0;
		ctx.fillStyle = glow.config.color ?? color;
		ctx.fillText(char, drawX, drawY);
		ctx.restore();
	}
	ctx.fillStyle = fillColor;
	ctx.fillText(char, drawX, drawY);
	ctx.restore();
}
//#endregion
//#region src/core/render-elements.ts
const PAD_V_CSS = "max(0.2em, 0.9em - 0.5lh)";
function buildRootProps(options) {
	const text = options.text ?? "";
	const font = resolveBundle(options.font);
	const fontFamily = font?.family;
	const duration = text && font ? computeTimeline(text, font, options.timing).totalDuration : 0;
	const timeObj = typeof options.time === "object" ? options.time : null;
	const rawTime = typeof options.time === "number" ? options.time : timeObj?.mode === "controlled" ? timeObj.unit === "progress" ? timeObj.value * duration : timeObj.value : timeObj?.mode === "uncontrolled" ? timeObj.initialTime ?? 0 : 0;
	const easing = timeObj?.mode === "uncontrolled" ? timeObj.easing : void 0;
	const time = easing && duration > 0 ? easing(rawTime / duration) * duration : rawTime;
	const progress = duration > 0 ? time / duration : 0;
	return {
		"data-tegaki": "root",
		style: {
			position: "relative",
			maxWidth: "100%",
			width: "auto",
			height: "auto",
			fontFamily: fontFamily ?? void 0,
			[CSS_DURATION]: duration,
			[CSS_TIME]: time,
			[CSS_PROGRESS]: progress
		}
	};
}
function buildChildren(options, h) {
	const text = options.text ?? "";
	const isCss = options.time === "css" || typeof options.time === "object" && options.time?.mode === "css";
	const showOverlay = options.showOverlay;
	return h("span", { style: {
		display: "block",
		position: "relative"
	} }, h("span", {
		"data-tegaki": "sentinel",
		"aria-hidden": "true",
		style: {
			position: "absolute",
			width: 0,
			overflow: "hidden",
			pointerEvents: "none",
			fontSize: "inherit",
			lineHeight: "inherit",
			visibility: "hidden",
			transition: isCss ? `font-size 0.001s, line-height 0.001s, color 0.001s, ${CSS_PROGRESS} 0.001s` : "font-size 0.001s, line-height 0.001s, color 0.001s"
		}
	}), h("canvas", {
		"data-tegaki": "canvas",
		"aria-hidden": "true",
		style: {
			position: "absolute",
			inset: `calc(-1 * ${PAD_V_CSS}) -0.2em`,
			width: "calc(100% + 0.4em)",
			height: `calc(100% + 2 * ${PAD_V_CSS})`,
			pointerEvents: "none",
			overflow: "visible"
		}
	}, h("span", {
		"data-tegaki": "canvas-fallback",
		style: {
			display: "inline-block",
			padding: `${PAD_V_CSS} 0.2em`
		}
	}, text)), h("span", {
		"data-tegaki": "overlay",
		style: {
			display: "block",
			userSelect: "auto",
			whiteSpace: "pre-wrap",
			overflowWrap: "break-word",
			paddingRight: 1,
			WebkitTextFillColor: showOverlay ? void 0 : "transparent",
			color: showOverlay ? "rgba(255, 0, 0, 0.4)" : void 0
		}
	}, text));
}
function domCreateElement(tag, props, ...children) {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) if (key === "style" && typeof value === "object") {
		for (const [k, v] of Object.entries(value)) if (v !== void 0 && v !== null) if (k.startsWith("--")) el.style.setProperty(k, String(v));
		else el.style[k] = typeof v === "number" && k !== "opacity" && k !== "zIndex" ? `${v}px` : v;
	} else if (key === "aria-hidden") el.setAttribute("aria-hidden", String(value));
	else if (key.startsWith("data-")) el.setAttribute(key, String(value));
	for (const child of children) if (typeof child === "string") el.appendChild(document.createTextNode(child));
	else el.appendChild(child);
	return el;
}
//#endregion
//#region src/core/engine.ts
function resolveTimeControl(prop) {
	if (prop == null) return { mode: "uncontrolled" };
	if (typeof prop === "number") return {
		mode: "controlled",
		value: prop
	};
	if (prop === "css") return { mode: "css" };
	return prop;
}
var TegakiEngine = class {
	/** Register a font bundle so it can be referenced by family name. */
	static registerBundle(bundle) {
		registerBundle(bundle);
	}
	/** Look up a registered bundle by family name. */
	static getBundle(family) {
		return getBundle(family);
	}
	_rootEl;
	_contentEl = null;
	_sentinelEl;
	_canvasEl;
	_overlayEl;
	_canvasFallbackEl;
	_text = "";
	_font = null;
	_timeControl = { mode: "uncontrolled" };
	_effects;
	_timing;
	_segmentSize;
	_showOverlay = false;
	_onComplete;
	_resolvedEffects = resolveEffects(void 0);
	_seed;
	_timeline = {
		entries: [],
		totalDuration: 0
	};
	_layout = null;
	_layoutKey = "";
	_fontReady = false;
	_containerWidth = 0;
	_fontSize = 0;
	_lineHeight = 0;
	_currentColor = "";
	_internalTime = 0;
	_cssTime = 0;
	_playing = true;
	_smoothedBoost = 0;
	_delayRemaining = 0;
	_loopGapRemaining = 0;
	_lastTs = null;
	_rafId = 0;
	_prevCompleted = false;
	_prefersReducedMotion = false;
	_destroyed = false;
	_resizeObserver;
	_mql = null;
	/**
	* Returns the props (including style) that should be applied to the container element,
	* plus the inner content tree rendered via a framework `createElement` callback.
	*
	* Each child element receives a `data-tegaki` attribute so the engine can adopt
	* pre-rendered elements later via `new TegakiEngine(container, { adopt: true })`.
	*/
	static renderElements(options, createElement) {
		return {
			rootProps: buildRootProps(options),
			content: buildChildren(options, createElement)
		};
	}
	constructor(container, options) {
		registerCssProperties();
		this._seed = Math.random() * 1e3;
		this._rootEl = container;
		if (options?.adopt) {} else {
			const content = buildChildren(options ?? {}, domCreateElement);
			container.appendChild(content);
			this._contentEl = content;
			const rootProps = buildRootProps(options ?? {});
			for (const [key, value] of Object.entries(rootProps.style)) if (value !== void 0 && value !== null) if (key.startsWith("--")) container.style.setProperty(key, String(value));
			else container.style[key] = typeof value === "number" && key !== "opacity" && key !== "zIndex" ? `${value}px` : value;
			container.dataset.tegaki = "root";
		}
		this._sentinelEl = container.querySelector("[data-tegaki=\"sentinel\"]");
		this._canvasEl = container.querySelector("[data-tegaki=\"canvas\"]");
		this._canvasFallbackEl = container.querySelector("[data-tegaki=\"canvas-fallback\"]");
		this._overlayEl = container.querySelector("[data-tegaki=\"overlay\"]");
		this._resizeObserver = new ResizeObserver(this._onResize);
		this._resizeObserver.observe(this._rootEl);
		this._sentinelEl.addEventListener("transitionend", this._onSentinelTransition);
		if (typeof window !== "undefined") {
			this._mql = window.matchMedia("(prefers-reduced-motion: reduce)");
			this._prefersReducedMotion = this._mql.matches;
			this._mql.addEventListener("change", this._onReducedMotionChange);
		}
		this._measure();
		if (options) this.update(options);
	}
	get currentTime() {
		const tc = this._timeControl;
		if (tc.mode === "css") return this._cssTime;
		if (tc.mode === "controlled") return tc.unit === "progress" ? tc.value * this._timeline.totalDuration : tc.value;
		const totalDur = this._timeline.totalDuration;
		if (tc.easing && totalDur > 0) return tc.easing(this._internalTime / totalDur) * totalDur;
		return this._internalTime;
	}
	get duration() {
		return this._timeline.totalDuration;
	}
	get isPlaying() {
		return this._playing;
	}
	get isComplete() {
		const totalDur = this._timeline.totalDuration;
		if (totalDur === 0) return false;
		if (this._timeControl.mode === "uncontrolled") return this._internalTime >= totalDur;
		return this.currentTime >= totalDur;
	}
	get element() {
		return this._rootEl;
	}
	play() {
		if (this._timeControl.mode !== "uncontrolled") return;
		this._playing = true;
		this._evaluatePlayback();
	}
	pause() {
		if (this._timeControl.mode !== "uncontrolled") return;
		this._playing = false;
		this._evaluatePlayback();
	}
	seek(time) {
		if (this._timeControl.mode !== "uncontrolled") return;
		this._internalTime = Math.max(0, Math.min(time, this._timeline.totalDuration));
		this._delayRemaining = 0;
		this._loopGapRemaining = 0;
		this._checkCompletion();
		this._notifyTimeChange();
		this._render();
		this._updateCssProperties();
	}
	restart() {
		if (this._timeControl.mode !== "uncontrolled") return;
		this._internalTime = 0;
		this._playing = true;
		this._prevCompleted = false;
		this._delayRemaining = this._timeControl.delay ?? 0;
		this._loopGapRemaining = 0;
		this._notifyTimeChange();
		this._evaluatePlayback();
	}
	update(options) {
		if (this._destroyed) return;
		let dirtyTimeline = false;
		let dirtyLayout = false;
		let dirtyRender = false;
		let dirtyPlayback = false;
		if ("text" in options && options.text !== this._text) {
			this._text = options.text ?? "";
			dirtyTimeline = true;
			dirtyLayout = true;
		}
		if ("font" in options) {
			const resolved = resolveBundle(options.font) ?? null;
			if (resolved !== this._font) {
				this._loadFont(resolved);
				dirtyTimeline = true;
				dirtyLayout = true;
				dirtyPlayback = true;
			}
		}
		if ("time" in options) {
			const newTc = resolveTimeControl(options.time);
			const oldTc = this._timeControl;
			const modeChanged = newTc.mode !== oldTc.mode;
			const controlledValueChanged = newTc.mode === "controlled" && oldTc.mode === "controlled" && (newTc.value !== oldTc.value || newTc.unit !== oldTc.unit);
			const uncontrolledChanged = newTc.mode === "uncontrolled" && oldTc.mode === "uncontrolled" && (newTc.speed !== oldTc.speed || newTc.duration !== oldTc.duration || newTc.playing !== oldTc.playing || newTc.loop !== oldTc.loop || newTc.delay !== oldTc.delay || newTc.loopGap !== oldTc.loopGap || newTc.catchUp !== oldTc.catchUp || newTc.easing !== oldTc.easing);
			if (modeChanged || controlledValueChanged || uncontrolledChanged) {
				this._timeControl = newTc;
				if (newTc.mode === "uncontrolled") {
					this._playing = newTc.playing ?? true;
					const oldDelay = oldTc.mode === "uncontrolled" ? oldTc.delay ?? 0 : 0;
					const newDelay = newTc.delay ?? 0;
					if (modeChanged || oldDelay !== newDelay) {
						this._delayRemaining = newDelay;
						this._loopGapRemaining = 0;
					}
				}
				dirtyPlayback = true;
				dirtyRender = true;
				this._updateSentinelTransition();
			}
		}
		if ("effects" in options && options.effects !== this._effects) {
			this._effects = options.effects;
			this._resolvedEffects = resolveEffects(this._effects);
			dirtyRender = true;
		}
		if ("timing" in options && options.timing !== this._timing) {
			this._timing = options.timing;
			dirtyTimeline = true;
		}
		if ("segmentSize" in options && options.segmentSize !== this._segmentSize) {
			this._segmentSize = options.segmentSize;
			dirtyRender = true;
		}
		if ("showOverlay" in options && options.showOverlay !== this._showOverlay) {
			this._showOverlay = options.showOverlay ?? false;
			this._updateOverlayStyle();
			dirtyRender = true;
		}
		if ("onComplete" in options) this._onComplete = options.onComplete;
		if (dirtyTimeline) this._recomputeTimeline();
		if (dirtyRender || dirtyTimeline || dirtyLayout) this._updateDom();
		if (dirtyLayout) this._recomputeLayout();
		if (dirtyPlayback) this._evaluatePlayback();
		if (dirtyRender || dirtyTimeline || dirtyLayout) this._render();
	}
	destroy() {
		this._destroyed = true;
		this._stopLoop();
		this._resizeObserver.disconnect();
		this._sentinelEl.removeEventListener("transitionend", this._onSentinelTransition);
		this._mql?.removeEventListener("change", this._onReducedMotionChange);
		this._contentEl?.remove();
	}
	/** Estimate line-height from font metrics when CSS returns "normal". */
	_fallbackLineHeight(fontSize) {
		if (this._font) return (this._font.ascender - this._font.descender) / this._font.unitsPerEm * fontSize;
		return fontSize * 1.2;
	}
	_measure() {
		const styles = getComputedStyle(this._rootEl);
		this._containerWidth = this._rootEl.getBoundingClientRect().width;
		this._fontSize = Number.parseFloat(styles.fontSize);
		const parsedLh = Number.parseFloat(styles.lineHeight);
		this._lineHeight = Number.isNaN(parsedLh) ? this._fallbackLineHeight(this._fontSize) : parsedLh;
		this._currentColor = styles.color;
	}
	_updateDom() {
		this._rootEl.style.fontFamily = this._font?.family ?? "";
		this._updateCssProperties();
		if (this._overlayEl.textContent !== this._text) this._overlayEl.textContent = this._text;
		this._canvasFallbackEl.textContent = this._text;
	}
	_updateCssProperties() {
		const time = this.currentTime;
		const dur = this._timeline.totalDuration;
		this._rootEl.style.setProperty(CSS_DURATION, String(dur));
		this._rootEl.style.setProperty(CSS_TIME, String(time));
		this._rootEl.style.setProperty(CSS_PROGRESS, String(dur > 0 ? time / dur : 0));
	}
	_updateOverlayStyle() {
		if (this._showOverlay) {
			this._overlayEl.style.webkitTextFillColor = "";
			this._overlayEl.style.color = "rgba(255, 0, 0, 0.4)";
		} else {
			this._overlayEl.style.webkitTextFillColor = "transparent";
			this._overlayEl.style.color = "";
		}
	}
	_updateSentinelTransition() {
		const isCss = this._timeControl.mode === "css";
		this._sentinelEl.style.transition = isCss ? `font-size 0.001s, line-height 0.001s, color 0.001s, ${CSS_PROGRESS} 0.001s` : "font-size 0.001s, line-height 0.001s, color 0.001s";
	}
	_onResize = (entries) => {
		const entry = entries[0];
		if (!entry) return;
		const newWidth = entry.contentRect.width;
		const styles = getComputedStyle(this._rootEl);
		const newFontSize = Number.parseFloat(styles.fontSize);
		const parsedLh = Number.parseFloat(styles.lineHeight);
		const newLineHeight = Number.isNaN(parsedLh) ? this._fallbackLineHeight(newFontSize) : parsedLh;
		const newColor = styles.color;
		let changed = false;
		let layoutChanged = false;
		if (newWidth !== this._containerWidth) {
			this._containerWidth = newWidth;
			layoutChanged = true;
			changed = true;
		}
		if (newFontSize !== this._fontSize) {
			this._fontSize = newFontSize;
			layoutChanged = true;
			changed = true;
		}
		if (newLineHeight !== this._lineHeight) {
			this._lineHeight = newLineHeight;
			layoutChanged = true;
			changed = true;
		}
		if (newColor !== this._currentColor) {
			this._currentColor = newColor;
			changed = true;
		}
		if (layoutChanged) this._recomputeLayout();
		if (changed) this._render();
	};
	_onSentinelTransition = (e) => {
		const styles = getComputedStyle(this._sentinelEl);
		let changed = false;
		if (e.propertyName === "font-size" || e.propertyName === "line-height") {
			const newFontSize = Number.parseFloat(styles.fontSize);
			const parsedLh = Number.parseFloat(styles.lineHeight);
			const newLineHeight = Number.isNaN(parsedLh) ? this._fallbackLineHeight(newFontSize) : parsedLh;
			if (newFontSize !== this._fontSize || newLineHeight !== this._lineHeight) {
				this._fontSize = newFontSize;
				this._lineHeight = newLineHeight;
				this._recomputeLayout();
				changed = true;
			}
		}
		if (e.propertyName === "color") {
			const newColor = styles.color;
			if (newColor !== this._currentColor) {
				this._currentColor = newColor;
				changed = true;
			}
		}
		if (e.propertyName === "--tegaki-progress") {
			this._cssTime = Number(styles.getPropertyValue(CSS_PROGRESS)) * this._timeline.totalDuration;
			changed = true;
		}
		if (changed) this._render();
	};
	_onReducedMotionChange = (e) => {
		this._prefersReducedMotion = e.matches;
		if (this._prefersReducedMotion && this._timeControl.mode === "uncontrolled" && this._timeline.totalDuration > 0) this._internalTime = this._timeline.totalDuration;
		this._evaluatePlayback();
		this._render();
	};
	_loadFont(font) {
		this._font = font;
		this._fontReady = false;
		if (!font) return;
		const pending = ensureFont(font.family, font.fontUrl);
		if (pending === null) {
			this._fontReady = true;
			return;
		}
		const currentFont = font;
		pending.then(() => {
			if (this._font === currentFont && !this._destroyed) {
				this._fontReady = true;
				this._recomputeTimeline();
				this._updateDom();
				this._recomputeLayout();
				this._evaluatePlayback();
				this._render();
			}
		});
	}
	_recomputeTimeline() {
		if (this._font && this._text) this._timeline = computeTimeline(this._text, this._font, this._timing);
		else this._timeline = {
			entries: [],
			totalDuration: 0
		};
	}
	_recomputeLayout() {
		if (this._fontReady && this._font?.family && this._fontSize && this._containerWidth && this._text) {
			const key = `${this._text}\0${this._font.family}\0${this._fontSize}\0${this._lineHeight}\0${this._containerWidth}`;
			if (key === this._layoutKey) return;
			this._layoutKey = key;
			this._layout = computeTextLayout(this._overlayEl, this._fontSize);
		} else {
			this._layoutKey = "";
			this._layout = null;
		}
	}
	_evaluatePlayback() {
		if (this._timeControl.mode === "uncontrolled" && this._playing && !!this._font && this._fontReady && !this._prefersReducedMotion) this._startLoop();
		else this._stopLoop();
	}
	_startLoop() {
		if (this._rafId) return;
		this._lastTs = null;
		this._smoothedBoost = 0;
		this._rafId = requestAnimationFrame(this._tick);
	}
	_stopLoop() {
		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = 0;
		}
	}
	_tick = (ts) => {
		if (this._destroyed) return;
		if (this._lastTs === null) this._lastTs = ts;
		const dtSec = (ts - this._lastTs) / 1e3;
		this._lastTs = ts;
		const tc = this._timeControl;
		if (tc.mode !== "uncontrolled") return;
		const loop = tc.loop ?? false;
		const totalDur = this._timeline.totalDuration;
		const durationOverride = tc.duration;
		const useDuration = durationOverride !== void 0 && durationOverride > 0;
		if (totalDur === 0 || !loop && this._internalTime >= totalDur) {
			this._internalTime = totalDur;
			this._rafId = requestAnimationFrame(this._tick);
			return;
		}
		if (this._delayRemaining > 0) {
			this._delayRemaining = Math.max(0, this._delayRemaining - dtSec);
			this._rafId = requestAnimationFrame(this._tick);
			return;
		}
		if (this._loopGapRemaining > 0) {
			this._loopGapRemaining = Math.max(0, this._loopGapRemaining - dtSec);
			if (this._loopGapRemaining <= 0) {
				this._internalTime = 0;
				this._prevCompleted = false;
				this._smoothedBoost = 0;
			}
			this._notifyTimeChange();
			this._render();
			this._updateCssProperties();
			this._rafId = requestAnimationFrame(this._tick);
			return;
		}
		let effectiveSpeed;
		if (useDuration) effectiveSpeed = totalDur / durationOverride;
		else {
			const speed = tc.speed ?? 1;
			const catchUp = tc.catchUp ?? 0;
			effectiveSpeed = speed;
			if (catchUp > 0) {
				const remaining = Math.max(0, totalDur - this._internalTime);
				const targetBoost = catchUp * Math.max(0, remaining - 2);
				const attackRate = 4;
				const releaseRate = loop ? 30 : 2;
				const rate = targetBoost > this._smoothedBoost ? attackRate : releaseRate;
				this._smoothedBoost += (targetBoost - this._smoothedBoost) * (1 - Math.exp(-rate * dtSec));
				effectiveSpeed = speed + this._smoothedBoost;
			}
		}
		let next = this._internalTime + dtSec * effectiveSpeed;
		if (next >= totalDur) {
			if (loop) {
				const loopGap = tc.loopGap ?? 0;
				if (loopGap > 0) {
					next = totalDur;
					this._loopGapRemaining = loopGap;
				} else if (this._internalTime < totalDur) next = totalDur;
				else next %= totalDur;
			} else next = totalDur;
			this._smoothedBoost = 0;
		}
		this._internalTime = next;
		this._notifyTimeChange();
		this._checkCompletion();
		this._render();
		this._updateCssProperties();
		this._rafId = requestAnimationFrame(this._tick);
	};
	_notifyTimeChange() {
		const tc = this._timeControl;
		if (tc.mode === "uncontrolled" && tc.onTimeChange) tc.onTimeChange(this.currentTime);
	}
	_checkCompletion() {
		const complete = this.isComplete;
		if (complete && !this._prevCompleted) {
			this._prevCompleted = true;
			this._onComplete?.();
		} else if (!complete) this._prevCompleted = false;
	}
	_render() {
		const canvas = this._canvasEl;
		const font = this._font;
		const layout = this._layout;
		const fontSize = this._fontSize;
		if (!font?.glyphData || !layout || !fontSize) return;
		const dpr = window.devicePixelRatio || 1;
		const w = canvas.offsetWidth;
		const h = canvas.offsetHeight;
		if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		const padH = PADDING_H_EM * fontSize;
		const lineHeight = this._lineHeight;
		const padV = Math.max(MIN_PADDING_V_EM * fontSize, (MIN_LINE_HEIGHT_EM * fontSize - lineHeight) / 2);
		ctx.translate(padH, padV);
		const color = this._currentColor || "black";
		const halfLeading = (lineHeight - (font.ascender - font.descender) / font.unitsPerEm * fontSize) / 2;
		const characters = graphemes(this._text);
		const currentTime = this.currentTime;
		let y = 0;
		for (const lineIndices of layout.lines) {
			for (const charIdx of lineIndices) {
				const char = characters[charIdx];
				if (char === "\n") continue;
				const entry = this._timeline.entries[charIdx];
				const x = (layout.charOffsets[charIdx] ?? 0) * fontSize;
				const glyph = font.glyphData[char];
				if (glyph && entry.hasGlyph) {
					const localTime = Math.max(0, Math.min(currentTime - entry.offset, entry.duration));
					drawGlyph(ctx, glyph, {
						x,
						y: y + halfLeading,
						fontSize,
						unitsPerEm: font.unitsPerEm,
						ascender: font.ascender,
						descender: font.descender
					}, localTime, font.lineCap, color, this._resolvedEffects, this._seed + charIdx, this._segmentSize);
				} else if (!entry.hasGlyph && currentTime >= entry.offset + entry.duration) drawFallbackGlyph(ctx, char, x, y + halfLeading + font.ascender / font.unitsPerEm * fontSize, fontSize, font.family, color, this._resolvedEffects, this._seed + charIdx);
			}
			y += lineHeight;
		}
	}
};
//#endregion
export { createBundle as a, resolveBundle as c, ensureFontFace as d, drawGlyph as f, domCreateElement as i, computeTimeline as l, resolveEffects as m, buildChildren as n, getBundle as o, coerceToString as p, buildRootProps as r, registerBundle as s, TegakiEngine as t, computeTextLayout as u };

//# sourceMappingURL=core-I9K3LqxK.mjs.map