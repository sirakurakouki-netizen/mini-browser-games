(function attachScaCosmeticRenderer(globalScope) {
  "use strict";

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function drawable(options, minimumRadius) {
    const definition = options?.definition;
    if (!definition || definition.type !== "special" || !definition.pattern) return false;
    const radius = Number(options.worldRadius ?? options.radius) || 0;
    if (radius < minimumRadius) return false;
    if ((Number(options.splitCount) || 1) > 10 && radius < 42) return false;
    if (options.lowQuality && radius < 58) return false;
    return true;
  }

  function drawTrail(options = {}) {
    if (!drawable(options, 26)) return false;
    const context = options.context;
    const trail = options.definition;
    const vx = Number(options.vx) || 0;
    const vy = Number(options.vy) || 0;
    const speed = Math.hypot(vx, vy);
    if (!context || speed < 16) return false;
    const x0 = Number(options.x) || 0;
    const y0 = Number(options.y) || 0;
    const radius = Number(options.radius) || 0;
    const now = Number(options.now) || 0;
    const lineScale = Number(options.lineScale) || 1;
    const dir = { x: -vx / speed, y: -vy / speed };
    const side = { x: -dir.y, y: dir.x };
    const accent = trail.accent || "#ffffff";
    const base = trail.color || options.baseColor || "#ffffff";
    const count = options.lowQuality ? 2 : 4;
    const pulse = Math.sin(now / 160 + x0 * 0.01) * 0.18;

    context.save();
    context.shadowBlur = options.lowQuality ? 0 : 10 * lineScale;
    context.shadowColor = accent;
    for (let index = 0; index < count; index++) {
      const distance = radius * (0.72 + (index + 1) * 0.36);
      const wobble = Math.sin(now / 220 + index * 1.7) * radius * 0.1;
      const x = x0 + dir.x * distance + side.x * wobble;
      const y = y0 + dir.y * distance + side.y * wobble;
      const size = Math.max(3 * lineScale, radius * (0.17 - index * 0.026));
      context.globalAlpha = clamp(0.34 - index * 0.055 + pulse * 0.05, 0.08, 0.38);
      context.fillStyle = index % 2 ? accent : base;
      context.strokeStyle = accent;
      context.lineWidth = 1.3 * lineScale;
      if (trail.pattern === "arc" || trail.pattern === "rift") {
        context.beginPath();
        context.moveTo(x - side.x * size, y - side.y * size);
        context.lineTo(x + dir.x * size * 0.5, y + dir.y * size * 0.5);
        context.lineTo(x + side.x * size, y + side.y * size);
        context.stroke();
      } else if (trail.pattern === "ribbon" || trail.pattern === "flame") {
        context.beginPath();
        context.ellipse(x, y, size * 1.35, size * 0.45, Math.atan2(dir.y, dir.x), 0, Math.PI * 2);
        context.fill();
      } else if (trail.pattern === "squares") {
        context.save();
        context.translate(x, y);
        context.rotate(now / 500 + index);
        context.fillRect(-size * 0.55, -size * 0.55, size * 1.1, size * 1.1);
        context.restore();
      } else if (trail.pattern === "petals") {
        context.beginPath();
        context.ellipse(x, y, size * 0.65, size * 1.05, Math.atan2(side.y, side.x), 0, Math.PI * 2);
        context.fill();
      } else {
        context.beginPath();
        context.arc(x, y, trail.pattern === "bubbles" ? size * 0.78 : size, 0, Math.PI * 2);
        if (trail.pattern === "bubbles") context.stroke();
        else context.fill();
      }
    }
    context.restore();
    return true;
  }

  function drawHalo(options = {}) {
    if (!drawable(options, 30)) return false;
    const context = options.context;
    const halo = options.definition;
    if (!context) return false;
    const x = Number(options.x) || 0;
    const y = Number(options.y) || 0;
    const radius = Number(options.radius) || 0;
    const now = Number(options.now) || 0;
    const lineScale = Number(options.lineScale) || 1;
    const accent = halo.accent || "#ffffff";
    const base = halo.color || options.baseColor || "#ffffff";
    const spin = now / 1500;
    const outer = radius + 12 * lineScale;

    context.save();
    context.shadowBlur = options.lowQuality ? 0 : 13 * lineScale;
    context.shadowColor = accent;
    context.globalAlpha = options.lowQuality ? 0.36 : 0.58;
    context.strokeStyle = accent;
    context.lineWidth = 2.4 * lineScale;
    if (halo.pattern === "orbit") {
      context.beginPath();
      context.arc(x, y, outer, spin, spin + Math.PI * 1.45);
      context.stroke();
      context.globalAlpha *= 0.68;
      context.strokeStyle = base;
      context.beginPath();
      context.arc(x, y, outer + 8 * lineScale, spin + Math.PI, spin + Math.PI * 1.9);
      context.stroke();
    } else if (halo.pattern === "frost") {
      context.setLineDash([6 * lineScale, 8 * lineScale]);
      context.beginPath();
      context.arc(x, y, outer, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    } else if (halo.pattern === "pulse") {
      for (let index = 0; index < 2; index++) {
        context.globalAlpha = (options.lowQuality ? 0.24 : 0.44) - index * 0.12;
        context.beginPath();
        context.arc(x, y, outer + index * 9 * lineScale + Math.sin(spin * 2 + index) * 2 * lineScale, 0, Math.PI * 2);
        context.stroke();
      }
    } else if (halo.pattern === "sun") {
      context.beginPath();
      for (let index = 0; index < 18; index++) {
        const angle = spin + index / 18 * Math.PI * 2;
        const inner = outer + (index % 2) * 3 * lineScale;
        const tip = outer + (index % 2 === 0 ? 13 : 8) * lineScale;
        context.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
        context.lineTo(x + Math.cos(angle) * tip, y + Math.sin(angle) * tip);
      }
      context.stroke();
    } else if (halo.pattern === "crown") {
      context.beginPath();
      context.arc(x, y, outer, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = accent;
      context.globalAlpha = options.lowQuality ? 0.28 : 0.46;
      for (let index = 0; index < 5; index++) {
        const angle = spin * 0.6 + index / 5 * Math.PI * 2;
        context.beginPath();
        context.arc(x + Math.cos(angle) * (outer + 3 * lineScale), y + Math.sin(angle) * (outer + 3 * lineScale), Math.max(2.5 * lineScale, radius * 0.055), 0, Math.PI * 2);
        context.fill();
      }
    } else if (halo.pattern === "gravity") {
      context.strokeStyle = accent;
      context.lineWidth = 3 * lineScale;
      context.beginPath();
      context.arc(x, y, outer, spin, spin + Math.PI * 1.72);
      context.stroke();
      context.globalAlpha = options.lowQuality ? 0.18 : 0.34;
      context.strokeStyle = base;
      context.beginPath();
      context.arc(x, y, outer + 10 * lineScale, -spin, -spin + Math.PI * 1.2);
      context.stroke();
    }
    context.restore();
    return true;
  }

  function drawSkin(options = {}) {
    if (!drawable(options, 24)) return false;
    const context = options.context;
    const skin = options.definition;
    if (!context) return false;
    const x = Number(options.x) || 0;
    const y = Number(options.y) || 0;
    const radius = Number(options.radius) || 0;
    const now = Number(options.now) || 0;
    const lineScale = Number(options.lineScale) || 1;
    const accent = skin.accent || "#ffffff";
    const spin = now / 1600;

    context.save();
    context.beginPath();
    context.arc(x, y, radius * 0.96, 0, Math.PI * 2);
    context.clip();
    context.shadowBlur = 0;
    if (skin.pattern === "comet") {
      context.globalAlpha = 0.26;
      context.strokeStyle = accent;
      context.lineWidth = Math.max(3 * lineScale, radius * 0.09);
      for (let index = -2; index <= 2; index++) {
        const rowY = y + index * radius * 0.26 + Math.sin(spin + index) * radius * 0.06;
        context.beginPath();
        context.moveTo(x - radius * 1.1, rowY + radius * 0.35);
        context.lineTo(x + radius * 1.1, rowY - radius * 0.35);
        context.stroke();
      }
    } else if (skin.pattern === "mecha") {
      context.globalAlpha = 0.34;
      context.strokeStyle = accent;
      context.lineWidth = 2 * lineScale;
      for (let ring = 0; ring < 3; ring++) {
        const rr = radius * (0.34 + ring * 0.18);
        context.beginPath();
        for (let side = 0; side < 6; side++) {
          const angle = spin * 0.35 + side / 6 * Math.PI * 2;
          const px = x + Math.cos(angle) * rr;
          const py = y + Math.sin(angle) * rr;
          if (side === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
        context.stroke();
      }
    } else if (skin.pattern === "tide") {
      context.globalAlpha = 0.28;
      context.strokeStyle = accent;
      context.lineWidth = Math.max(2 * lineScale, radius * 0.055);
      for (let row = -2; row <= 2; row++) {
        context.beginPath();
        for (let step = 0; step <= 16; step++) {
          const px = x - radius + step / 16 * radius * 2;
          const py = y + row * radius * 0.24 + Math.sin(step * 0.85 + spin * 2 + row) * radius * 0.08;
          if (step === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.stroke();
      }
    } else if (skin.pattern === "flare") {
      context.globalAlpha = 0.22;
      context.fillStyle = accent;
      for (let index = 0; index < 10; index++) {
        const angle = spin + index / 10 * Math.PI * 2;
        const rr = radius * (0.18 + index % 4 * 0.12);
        context.beginPath();
        context.arc(x + Math.cos(angle) * rr, y + Math.sin(angle) * rr, radius * 0.22, 0, Math.PI * 2);
        context.fill();
      }
    } else if (skin.pattern === "crown") {
      context.globalAlpha = 0.32;
      context.strokeStyle = accent;
      context.fillStyle = accent;
      context.lineWidth = 2.2 * lineScale;
      for (let index = 0; index < 6; index++) {
        const angle = spin * 0.45 + index / 6 * Math.PI * 2;
        const px = x + Math.cos(angle) * radius * 0.48;
        const py = y + Math.sin(angle) * radius * 0.48;
        context.beginPath();
        context.moveTo(px, py - radius * 0.15);
        context.lineTo(px - radius * 0.12, py + radius * 0.12);
        context.lineTo(px + radius * 0.12, py + radius * 0.12);
        context.closePath();
        context.fill();
      }
    } else if (skin.pattern === "abyss") {
      context.globalAlpha = 0.36;
      const gradient = context.createRadialGradient(x, y, radius * 0.08, x, y, radius * 0.78);
      gradient.addColorStop(0, "rgba(0, 0, 0, 0.72)");
      gradient.addColorStop(0.55, "rgba(17, 24, 39, 0.18)");
      gradient.addColorStop(1, accent);
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius * 0.76, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    context.save();
    context.globalAlpha = options.lowQuality ? 0.34 : 0.52;
    context.strokeStyle = accent;
    context.lineWidth = (skin.tier === "legendary" ? 3.2 : 2.4) * lineScale;
    context.beginPath();
    context.arc(x, y, radius + 4 * lineScale, spin, spin + Math.PI * 1.55);
    context.stroke();
    context.restore();
    return true;
  }

  globalScope.ScaCosmeticRenderer = Object.freeze({ drawTrail, drawHalo, drawSkin });
})(typeof globalThis !== "undefined" ? globalThis : window);
