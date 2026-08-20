import { useEffect, useRef } from "react";

const ACCENTS = ["#38bdf8", "#818cf8", "#f43f8f", "#f59e0b", "#7c3aed"];
const HERO_WHALES = [
  { role: "far", x: 0.08, y: 0.2, size: 0.12, rotation: -0.05, color: 2, phase: 3.1, flip: true, direction: 1, speed: 0.009, depth: 0.28, opacity: 0.36 },
  { role: "far", x: 0.9, y: 0.67, size: 0.15, rotation: -0.1, color: 3, phase: 4.4, flip: false, direction: -1, speed: 0.011, depth: 0.38, opacity: 0.42 },
  { role: "mid", x: 0.16, y: 0.48, size: 0.18, mobileX: 0.18, mobileY: 0.44, mobileSize: 0.14, rotation: -0.08, color: 1, phase: 0.2, flip: false, direction: -1, speed: 0.013, depth: 0.64, opacity: 0.68, mobile: true },
  { role: "lead", x: 0.76, y: 0.24, size: 0.24, mobileX: 0.76, mobileY: 0.21, mobileSize: 0.21, rotation: 0.05, color: 0, phase: 1.8, flip: true, direction: 1, speed: 0.016, depth: 1, opacity: 1, mobile: true },
];

const wrapWithPadding = (value, padding) => {
  const span = 1 + padding * 2;
  return ((((value + padding) % span) + span) % span) - padding;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (start, end, amount) => start + (end - start) * amount;
const easeOutCubic = (value) => 1 - (1 - value) ** 3;
const smoothstep = (value) => value * value * (3 - 2 * value);

export function AuroraCanvas({ compact = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d", { alpha: true });
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const abortController = new AbortController();
    let width = 0;
    let height = 0;
    let ratio = 1;
    let animationFrame = 0;
    let whalePath = null;
    let pointerX = 0.52;
    let pointerY = 0.42;
    let pointerInside = false;
    let pointerInfluence = 0;
    let lastPointerRipple = 0;
    const startedAt = performance.now();
    let sceneTime = startedAt;
    let lastFrameAt = startedAt;
    let lastWakeRipple = startedAt;
    let wakeWhaleIndex = 0;
    let isIntersecting = true;
    let isPageVisible = !document.hidden;
    let scrollTarget = 0;
    let scrollProgress = 0;
    let sonar = { x: 0.5, y: 0.5, born: startedAt - 3000 };
    const bursts = [];
    canvas.dataset.motionState = reduceMotion ? "static" : "idle";
    canvas.dataset.pulseCount = "0";
    canvas.dataset.burstCount = "0";
    canvas.dataset.sceneDepth = "3";
    canvas.dataset.scrollProgress = "0.00";
    const ripples = [
      { x: 0.58, y: 0.43, born: startedAt - 900, color: 0 },
      { x: 0.28, y: 0.7, born: startedAt - 300, color: 3 },
    ];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(rect.width, window.innerWidth, 1);
      height = Math.max(rect.height, compact ? 520 : window.innerHeight, compact ? 420 : 820);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const addRipple = (x, y, color, born, options = {}) => {
      ripples.push({ x, y, color, born, ...options });
      if (ripples.length > (compact ? 6 : 12)) ripples.shift();
    };

    const addBurst = (x, y, color, born) => {
      const particleCount = width < 640 ? 20 : compact ? 16 : 38;
      const particles = Array.from({ length: particleCount }, (_, index) => {
        const seed = Math.random();
        return {
          angle: (index / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.34,
          color: (color + index + Math.floor(seed * 2)) % ACCENTS.length,
          delay: Math.random() * 0.11,
          maxRadius: (44 + seed * 148) * (compact ? 0.72 : 1),
          size: 0.8 + Math.random() * 1.8,
          spin: (Math.random() - 0.5) * 1.8,
          startRadius: 24 + Math.random() * 42,
        };
      });
      bursts.push({ x, y, color, born, duration: compact ? 1320 : 1650, particles, spin: Math.random() > 0.5 ? 1 : -1 });
      if (bursts.length > 3) bursts.shift();
    };

    const drawLightShafts = (elapsed) => {
      const beamCount = width < 640 || compact ? 2 : 3;
      const dive = smoothstep(scrollProgress);
      context.save();
      context.globalCompositeOperation = "screen";
      context.filter = `blur(${compact ? 14 : 22}px)`;
      for (let beam = 0; beam < beamCount; beam += 1) {
        const phase = elapsed * (0.000055 + beam * 0.000009) + beam * 2.4;
        const topX = width * (0.18 + beam * 0.29) + Math.sin(phase) * width * 0.035;
        const bottomX = topX + Math.sin(phase * 0.73 + 1.2) * width * 0.08 + (pointerX - 0.5) * 18 * pointerInfluence;
        const halfTop = width * (0.018 + beam * 0.004);
        const halfBottom = width * (0.11 + beam * 0.016);
        const gradient = context.createLinearGradient(topX, 0, bottomX, height * 0.82);
        gradient.addColorStop(0, `rgba(164,225,255,${0.055 * (1 - dive * 0.72)})`);
        gradient.addColorStop(0.38, `rgba(84,169,229,${0.026 * (1 - dive * 0.72)})`);
        gradient.addColorStop(1, "rgba(23,82,128,0)");
        context.fillStyle = gradient;
        context.beginPath();
        context.moveTo(topX - halfTop, -24);
        context.lineTo(topX + halfTop, -24);
        context.lineTo(bottomX + halfBottom, height * 0.86);
        context.lineTo(bottomX - halfBottom, height * 0.86);
        context.closePath();
        context.fill();
      }
      context.restore();
    };

    const drawWaterField = (elapsed) => {
      context.save();
      context.globalCompositeOperation = "screen";
      const rows = compact ? 8 : 15;
      const dive = smoothstep(scrollProgress);
      const sonarAge = (elapsed - sonar.born) / 1650;
      const sonarActive = sonarAge >= 0 && sonarAge <= 1;
      for (let row = 0; row < rows; row += 1) {
        const rowProgress = row / Math.max(rows - 1, 1);
        const spreadY = rowProgress * height;
        const transitionY = height * (0.82 + rowProgress * 0.055);
        const baseY = lerp(spreadY, transitionY, dive * 0.86);
        context.beginPath();
        for (let point = 0; point <= 56; point += 1) {
          const sourceX = (point / 56) * width;
          const pointerDistance = Math.abs(sourceX / width - pointerX);
          const pointerLift = Math.exp(-pointerDistance * 11) * (pointerY - 0.5) * 13;
          let x = sourceX;
          let y = baseY
            + Math.sin(point * 0.42 + row * 0.82 + elapsed * 0.00045) * 2.6
            + Math.sin(point * 0.13 - elapsed * 0.00027) * 2
            + pointerLift;
          if (sonarActive) {
            const dx = sourceX / width - sonar.x;
            const dy = y / height - sonar.y;
            const distance = Math.hypot(dx * Math.min(width / height, 1.8), dy);
            const front = sonarAge * 0.68;
            const pressure = Math.sin((distance - front) * 31)
              * Math.exp(-Math.abs(distance - front) * 17)
              * Math.sin(sonarAge * Math.PI)
              * (compact ? 5 : 10);
            const normal = Math.max(distance, 0.025);
            x += (dx / normal) * pressure * 0.45;
            y += (dy / normal) * pressure;
          }
          if (point === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        const transitionGlow = 1 + dive * (row % 4 === 0 ? 1.1 : 0.35);
        context.strokeStyle = row % 4 === 0
          ? `rgba(56,189,248,${0.075 * transitionGlow})`
          : `rgba(139,169,196,${0.035 * transitionGlow})`;
        context.lineWidth = (row % 4 === 0 ? 0.7 : 0.45) + dive * 0.16;
        context.stroke();
      }
      context.restore();
    };

    const drawBurst = (burst, elapsed) => {
      const age = (elapsed - burst.born) / burst.duration;
      if (age < 0 || age > 1) return false;
      const x = burst.x * width;
      const y = burst.y * height;
      const fade = (1 - age) ** 1.7;
      const attack = Math.min(age / 0.13, 1);
      const coreRadius = 18 + easeOutCubic(attack) * 58 + age * 26;
      const core = context.createRadialGradient(x, y, 0, x, y, coreRadius);
      core.addColorStop(0, `rgba(236,250,255,${0.2 * fade})`);
      core.addColorStop(0.18, `rgba(56,189,248,${0.13 * fade})`);
      core.addColorStop(0.58, `rgba(129,140,248,${0.055 * fade})`);
      core.addColorStop(1, "rgba(2,7,13,0)");

      context.save();
      context.globalCompositeOperation = "screen";
      context.fillStyle = core;
      context.fillRect(x - coreRadius, y - coreRadius, coreRadius * 2, coreRadius * 2);

      burst.particles.forEach((particle) => {
        const localAge = clamp((age - particle.delay) / Math.max(1 - particle.delay, 0.01), 0, 1);
        if (localAge <= 0) return;
        const collapseEnd = 0.105;
        const expanding = localAge > collapseEnd;
        const expansionAge = clamp((localAge - collapseEnd) / (1 - collapseEnd), 0, 1);
        const radius = expanding
          ? 4 + easeOutCubic(expansionAge) * particle.maxRadius
          : particle.startRadius * (1 - easeOutCubic(localAge / collapseEnd)) + 4;
        const previousAge = Math.max(0, localAge - 0.032);
        const previousExpansion = clamp((previousAge - collapseEnd) / (1 - collapseEnd), 0, 1);
        const previousRadius = previousAge > collapseEnd
          ? 4 + easeOutCubic(previousExpansion) * particle.maxRadius
          : particle.startRadius * (1 - easeOutCubic(previousAge / collapseEnd)) + 4;
        const angle = particle.angle + burst.spin * localAge * 0.72 + particle.spin * Math.sin(localAge * Math.PI) * 0.34;
        const previousAngle = particle.angle + burst.spin * previousAge * 0.72 + particle.spin * Math.sin(previousAge * Math.PI) * 0.34;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius * 0.58;
        const previousX = x + Math.cos(previousAngle) * previousRadius;
        const previousY = y + Math.sin(previousAngle) * previousRadius * 0.58;
        const color = ACCENTS[particle.color];
        const particleFade = Math.sin(localAge * Math.PI) * fade;

        context.beginPath();
        context.moveTo(previousX, previousY);
        context.lineTo(px, py);
        context.strokeStyle = color;
        context.globalAlpha = particleFade * 0.52;
        context.lineWidth = particle.size * 0.72;
        context.shadowBlur = 9;
        context.shadowColor = color;
        context.stroke();

        context.beginPath();
        context.arc(px, py, particle.size, 0, Math.PI * 2);
        context.fillStyle = color;
        context.globalAlpha = particleFade * 0.82;
        context.fill();
      });

      const arcRadius = 24 + easeOutCubic(age) * Math.min(width, height) * (compact ? 0.16 : 0.22);
      for (let arc = 0; arc < 3; arc += 1) {
        context.beginPath();
        context.arc(x, y, arcRadius - arc * 10, burst.spin * age * 1.4 + arc * 2.08, burst.spin * age * 1.4 + arc * 2.08 + 0.52);
        context.strokeStyle = ACCENTS[(burst.color + arc) % ACCENTS.length];
        context.lineWidth = 0.9;
        context.globalAlpha = fade * (0.2 - arc * 0.035);
        context.shadowBlur = 12;
        context.stroke();
      }
      context.restore();
      return true;
    };

    const drawRipple = (ripple, elapsed) => {
      const age = (elapsed - ripple.born) / (ripple.duration ?? 2400);
      if (age < 0 || age > 1) return false;
      const x = ripple.x * width;
      const y = ripple.y * height;
      const scale = ripple.scale ?? 1;
      const radius = (20 + age * Math.min(width, height) * (compact ? 0.22 : 0.3)) * scale;
      const opacity = (1 - age) ** 2 * (ripple.strength ?? 1);
      const color = ACCENTS[ripple.color % ACCENTS.length];
      const rings = ripple.rings ?? (ripple.kind === "wake" ? 2 : 3);

      for (let ring = 0; ring < rings; ring += 1) {
        const ringRadius = radius - ring * 13 * scale;
        if (ringRadius <= 0) continue;
        context.save();
        context.globalCompositeOperation = "screen";
        context.globalAlpha = opacity * (0.3 - ring * 0.065);
        context.strokeStyle = color;
        context.lineWidth = ring === 0 ? 1 : 0.65;
        context.shadowBlur = 12;
        context.shadowColor = color;
        context.beginPath();
        for (let point = 0; point <= 72; point += 1) {
          const angle = (point / 72) * Math.PI * 2;
          const wobble = Math.sin(angle * 6 + elapsed * 0.003 + ring) * 2.2 * opacity;
          const px = x + Math.cos(angle) * (ringRadius + wobble);
          const py = y + Math.sin(angle) * (ringRadius * 0.31 + wobble * 0.35);
          if (point === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
        context.stroke();
        context.restore();
      }
      return true;
    };

    const getWhalePose = (whale, elapsed) => {
      const seconds = (elapsed - startedAt) / 1000;
      const isMobile = width < 640;
      const whaleSize = isMobile && whale.mobileSize ? whale.mobileSize : whale.size;
      const originX = isMobile && whale.mobileX != null ? whale.mobileX : whale.x;
      const originY = isMobile && whale.mobileY != null ? whale.mobileY : whale.y;
      const effectiveSpeed = whale.speed * (0.56 + whale.depth * 0.52);
      const padding = Math.min(0.24, whaleSize * 0.75 + 0.04);
      const strokeTime = seconds * (0.78 + effectiveSpeed * 9) + whale.phase;
      const swim = Math.sin(strokeTime * 2.35);
      const travel = seconds * effectiveSpeed
        + Math.sin(seconds * 0.62 + whale.phase) * effectiveSpeed * 0.42
        + Math.sin(seconds * 0.21 + whale.phase * 1.7) * effectiveSpeed * 0.3;
      const baseX = wrapWithPadding(originX + travel * whale.direction, padding);
      const pathAmplitude = (compact ? 0.012 : 0.018 + whaleSize * 0.025) * (0.56 + whale.depth * 0.54);
      const primaryPathTime = seconds * (0.29 + effectiveSpeed * 2.8) + whale.phase;
      const secondaryPathTime = seconds * 0.13 + whale.phase * 1.4;
      const baseY = originY
        + Math.sin(primaryPathTime) * pathAmplitude
        + Math.sin(secondaryPathTime) * pathAmplitude * 0.54;
      const velocityY = Math.cos(primaryPathTime) * pathAmplitude * (0.29 + effectiveSpeed * 2.8)
        + Math.cos(secondaryPathTime) * pathAmplitude * 0.54 * 0.13;
      const velocityX = effectiveSpeed * (1
        + Math.cos(seconds * 0.62 + whale.phase) * 0.26
        + Math.cos(seconds * 0.21 + whale.phase * 1.7) * 0.063);
      const pathPitch = clamp(
        Math.atan2(velocityY * height, Math.max(velocityX * width, 1)) * whale.direction,
        -0.16,
        0.16,
      );
      const aspect = Math.min(width / Math.max(height, 1), 2);
      const pointerDistance = Math.hypot((pointerX - baseX) * aspect, pointerY - baseY);
      const pointerPull = Math.max(0, 1 - pointerDistance / (compact ? 0.42 : 0.34)) * pointerInfluence * whale.depth;
      const sonarAge = (elapsed - sonar.born) / 1650;
      const sonarDistance = Math.hypot((sonar.x - baseX) * aspect, sonar.y - baseY);
      const sonarFront = sonarAge * 0.82;
      const sonarPulse = sonarAge >= 0 && sonarAge <= 1
        ? Math.exp(-(((sonarDistance - sonarFront) * 10) ** 2)) * Math.sin(sonarAge * Math.PI)
        : 0;
      const sonarDx = (baseX - sonar.x) * aspect;
      const sonarDy = baseY - sonar.y;
      const sonarNormal = Math.max(Math.hypot(sonarDx, sonarDy), 0.03);
      const orbitX = (-sonarDy / sonarNormal) * sonarPulse * 0.025 * whale.depth;
      const orbitY = (sonarDx / sonarNormal) * sonarPulse * 0.04 * whale.depth;
      const dive = smoothstep(scrollProgress);
      const steer = (pointerY - baseY) * pointerPull * 0.12
        + pathPitch
        + (sonarDx / sonarNormal) * sonarPulse * 0.11 * whale.depth
        + whale.direction * dive * (0.035 + whale.depth * 0.045);
      return {
        direction: whale.direction,
        pathPitch,
        steer,
        swim,
        x: baseX + (pointerX - baseX) * pointerPull * 0.018 + orbitX + whale.direction * dive * whale.depth * 0.025,
        y: baseY + (pointerY - baseY) * pointerPull * 0.075 + orbitY + dive * (0.08 + whale.depth * 0.23),
      };
    };

    const drawWhale = (whale, pose, elapsed) => {
      if (!whalePath) return;
      const mobileScaleBoost = width < 640 ? 1.75 : 1;
      const whaleSize = width < 640 && whale.mobileSize ? whale.mobileSize : whale.size;
      const scale = (width * whaleSize * mobileScaleBoost) / 50;
      const color = ACCENTS[whale.color];
      const surge = pose.swim * pose.direction * (compact ? 0.7 : 1.4);
      const breath = 1 + Math.sin(elapsed * 0.0015 + whale.phase) * 0.008;
      const bank = Math.sin(elapsed * 0.0011 + whale.phase * 1.3) * 0.012;
      const layerAlpha = whale.opacity * (1 - smoothstep(scrollProgress) * 0.7);
      const beamX = width * (0.61 + Math.sin(elapsed * 0.000055 + 2.4) * 0.035);
      const beamProximity = Math.exp(-Math.abs(pose.x * width - beamX) / Math.max(width * 0.12, 1)) * whale.depth;

      context.save();
      context.translate(pose.x * width + surge, pose.y * height);
      context.rotate(whale.rotation + pose.steer + bank + pose.swim * pose.direction * 0.006);
      context.scale((whale.flip ? -1 : 1) * scale, scale * breath);
      context.translate(-25, -25);
      context.filter = "none";

      context.globalCompositeOperation = "screen";
      context.globalAlpha = (compact ? 0.025 : 0.035) * layerAlpha;
      context.fillStyle = color;
      context.fill(whalePath);

      for (let pass = 3; pass >= 0; pass -= 1) {
        context.globalAlpha = (pass === 0 ? (compact ? 0.34 : 0.45) : 0.045) * layerAlpha;
        context.lineWidth = (pass === 0 ? 0.14 : 0.45 + pass * 0.34) * (0.74 + whale.depth * 0.26);
        context.strokeStyle = color;
        context.shadowBlur = pass * 8 * (0.5 + whale.depth * 0.5);
        context.shadowColor = color;
        context.stroke(whalePath);
      }
      if (beamProximity > 0.04 && whale.depth > 0.55) {
        context.globalAlpha = beamProximity * layerAlpha * 0.16;
        context.strokeStyle = "#d8f5ff";
        context.lineWidth = 0.12;
        context.shadowBlur = 10;
        context.shadowColor = "#9fe5ff";
        context.stroke(whalePath);
      }
      context.restore();
    };

    const render = (elapsed = sceneTime) => {
      context.clearRect(0, 0, width, height);

      const haze = context.createRadialGradient(width * 0.46, height * 0.34, 20, width * 0.46, height * 0.34, Math.max(width, height) * 0.72);
      haze.addColorStop(0, "rgba(23, 63, 104, 0.5)");
      haze.addColorStop(0.48, "rgba(8, 26, 48, 0.24)");
      haze.addColorStop(1, "rgba(2, 7, 13, 0)");
      context.fillStyle = haze;
      context.fillRect(0, 0, width, height);

      drawLightShafts(elapsed);
      drawWaterField(elapsed);

      for (let index = bursts.length - 1; index >= 0; index -= 1) {
        if (!drawBurst(bursts[index], elapsed)) bursts.splice(index, 1);
      }

      const visibleWhales = width < 640
        ? HERO_WHALES.filter((whale) => whale.mobile).slice(compact ? -1 : 0)
        : HERO_WHALES;
      const whalePoses = visibleWhales.map((whale) => getWhalePose(whale, elapsed));
      visibleWhales.forEach((whale, index) => drawWhale(whale, whalePoses[index], elapsed));

      if (!reduceMotion && elapsed - lastWakeRipple > (compact ? 1700 : 900)) {
        const wakeWhales = visibleWhales
          .map((whale, index) => ({ whale, pose: whalePoses[index] }))
          .filter(({ whale }) => whale.depth >= 0.6);
        const { whale, pose } = wakeWhales[wakeWhaleIndex % wakeWhales.length];
        const wakeX = pose.x - pose.direction * whale.size * 0.42;
        if (wakeX > 0.02 && wakeX < 0.98 && pose.y > 0.06 && pose.y < 0.94) {
          addRipple(wakeX, pose.y + 0.025, whale.color, elapsed, {
            duration: compact ? 1500 : 1800,
            kind: "wake",
            scale: compact ? 0.32 : 0.38,
            strength: 0.72,
          });
        }
        wakeWhaleIndex += 1;
        lastWakeRipple = elapsed;
      }
      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        if (!drawRipple(ripples[index], elapsed)) ripples.splice(index, 1);
      }
      canvas.dataset.scrollProgress = scrollProgress.toFixed(2);
    };

    const canAnimate = () => !reduceMotion && isIntersecting && isPageVisible;

    const animate = (now) => {
      animationFrame = 0;
      const delta = Math.min(Math.max(now - lastFrameAt, 0), 64);
      lastFrameAt = now;
      sceneTime += delta;
      pointerInfluence += ((pointerInside ? 1 : 0) - pointerInfluence) * 0.08;
      scrollTarget = clamp(window.scrollY / Math.max(height * 0.72, 1), 0, 1);
      scrollProgress += (scrollTarget - scrollProgress) * Math.min(1, delta * 0.008);
      render(sceneTime);
      if (canAnimate()) animationFrame = requestAnimationFrame(animate);
    };

    const startAnimation = () => {
      if (!canAnimate() || animationFrame) return;
      canvas.dataset.motionState = "running";
      lastFrameAt = performance.now();
      animationFrame = requestAnimationFrame(animate);
    };

    const stopAnimation = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      if (!reduceMotion) canvas.dataset.motionState = "paused";
    };

    const onPointerMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointerX = (event.clientX - rect.left) / Math.max(rect.width, 1);
      pointerY = (event.clientY - rect.top) / Math.max(rect.height, 1);
      pointerInside = pointerX >= 0 && pointerX <= 1 && pointerY >= 0 && pointerY <= 1;
      const now = performance.now();
      if (!pointerInside || reduceMotion || now - lastPointerRipple < 220) return;
      addRipple(pointerX, pointerY, Math.floor(pointerX * ACCENTS.length), sceneTime, {
        duration: 1050,
        kind: "cursor",
        scale: 0.24,
        strength: 0.5,
      });
      lastPointerRipple = now;
    };

    const onPointerDown = (event) => {
      if (reduceMotion || event.button > 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("a, button, input, video")) return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      sonar = { x, y, born: sceneTime };
      addBurst(x, y, Math.floor(x * ACCENTS.length), sceneTime);
      addRipple(x, y, Math.floor(x * ACCENTS.length), sceneTime, {
        duration: 1750,
        kind: "sonar",
        rings: compact ? 3 : 5,
        scale: compact ? 0.82 : 1.16,
        strength: compact ? 0.86 : 1.16,
      });
      canvas.dataset.pulseCount = String(Number(canvas.dataset.pulseCount || 0) + 1);
      canvas.dataset.burstCount = String(Number(canvas.dataset.burstCount || 0) + 1);
      startAnimation();
    };

    const onVisibilityChange = () => {
      isPageVisible = !document.hidden;
      if (isPageVisible) {
        render(sceneTime);
        startAnimation();
      } else {
        stopAnimation();
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      isIntersecting = entry.isIntersecting;
      if (isIntersecting) {
        render(sceneTime);
        startAnimation();
      } else {
        pointerInside = false;
        stopAnimation();
      }
    }, { threshold: 0.02 });

    const onResize = () => {
      resize();
      render(sceneTime);
    };

    const onScroll = () => {
      if (reduceMotion) return;
      scrollTarget = clamp(window.scrollY / Math.max(height * 0.72, 1), 0, 1);
      startAnimation();
    };

    const loadWhale = async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}whale.svg`, { signal: abortController.signal });
        const source = await response.text();
        const pathData = source.match(/\sd="([^"]+)"/)?.[1];
        if (pathData) whalePath = new Path2D(pathData);
        render(sceneTime);
      } catch (error) {
        if (error.name !== "AbortError") console.warn("Unable to load whale path", error);
      }
    };

    resize();
    loadWhale();
    render(sceneTime);
    startAnimation();
    observer.observe(canvas);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      abortController.abort();
      stopAnimation();
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [compact]);

  return <canvas ref={canvasRef} className="aurora-canvas" aria-hidden="true" />;
}
