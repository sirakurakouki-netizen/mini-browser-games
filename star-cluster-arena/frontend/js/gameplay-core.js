(function attachScaGameplayCore(globalScope) {
  "use strict";

  const MOVEMENT = Object.freeze({
    speedNumerator: 352,
    radiusDivisor: 96,
    fullSpeedDistance: 210,
    minimumDistanceScale: 0.08,
    playerSteerRate: 4.35,
    aiSteerRate: 3.35,
    dragPer60Hz: 0.965,
    splitImpulse: 650,
    splitMinimumMass: 32,
    ejectMinimumMass: 30
  });

  const MODE_SPEED = Object.freeze({
    solo: 1,
    team: 1,
    survival: 1,
    battle: 1,
    blitz: 1.16,
    spore: 1.06,
    screen: 1,
    control: 1,
    giant: 0.88,
    demon: 1
  });

  const VIRUS_RULES = Object.freeze({
    smallMassMultiplier: 1.08,
    bigMassMultiplier: 1.02,
    smallMinimumMass: 120,
    bigMinimumMass: 180,
    playerSmallPieces: 6,
    playerBigPieces: 8,
    botSmallPieces: 7,
    botBigPieces: 10,
    playerSmallFloor: 4,
    playerBigFloor: 5,
    botSmallFloor: 6,
    botBigFloor: 8,
    playerSmallDivisor: 54,
    playerBigDivisor: 46,
    botSmallDivisor: 42,
    botBigDivisor: 34,
    sporeMinimumLoss: 54,
    sporeMassPressureStart: 800,
    sporeMassPressureSpan: 9000,
    sporeMinimumRemainingMass: 40,
    humanSporeInitialAgeSeconds: 0.18,
    ownerHumanPickupSeconds: 0.32,
    ownerBotPickupSeconds: 0.48,
    playerOwnedOpponentPickupSeconds: 0.42,
    otherPickupSeconds: 0.16,
    pickupRadiusMultiplier: 0.42
  });

  const VIRUS_FEED = Object.freeze({
    smallBaseMass: 95,
    bigBaseMass: 260,
    sporeBaseMassMultiplier: 0.92,
    collisionRadiusMultiplier: 0.6,
    smallMassGainMultiplier: 0.7,
    bigMassGainMultiplier: 0.54,
    smallLaunchThreshold: 95,
    bigLaunchThreshold: 170,
    launchOffset: 80,
    smallLaunchSpeed: 420,
    bigLaunchSpeed: 330,
    smallRadiusMultiplier: 0.88,
    bigRadiusMinimum: 62,
    bigRadiusMaximum: 76,
    launchedLifetimeSeconds: 9,
    launchedDragPer60Hz: 0.985
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function radiusFromMass(mass, minimumRadius = 4) {
    return Math.max(finite(minimumRadius, 4), Math.sqrt(Math.max(1, finite(mass, 1))) * 4);
  }

  function mergeCooldownSeconds(mass, type, options = {}) {
    const scale = type === "virus-big" ? 0.42 : type === "virus" ? 0.36 : 0.3;
    const eventMultiplier = Math.max(0, finite(options.eventMultiplier, 1));
    const modeMultiplier = Math.max(0, finite(options.modeMultiplier, 1));
    const minimumBase = type === "split" ? 4.2 : 6.5;
    const maximumBase = type === "virus-big" ? 18 : type === "virus" ? 15 : 12;
    const minimum = minimumBase * eventMultiplier * modeMultiplier;
    const maximum = Math.max(minimum + 0.8, maximumBase * eventMultiplier * modeMultiplier);
    return clamp((22 + Math.max(0, finite(mass)) * 0.012) * scale * eventMultiplier * modeMultiplier, minimum, maximum);
  }

  function botStartMassRange(index, config = {}) {
    const position = Math.max(0, Math.floor(finite(index)));
    let range;
    if (config.ranking === "kills") range = position < 6 ? [230, 430] : [82, 240];
    else if (finite(config.teams) > 0) range = position < 10 ? [220, 460] : [86, 270];
    else if (config.respawn) range = position < 10 ? [260, 540] : position < 42 ? [120, 360] : [58, 230];
    else range = position < 8 ? [320, 680] : position < 34 ? [135, 430] : [72, 250];
    const scale = Math.max(0, finite(config.botMassScale, 1));
    return { minimum: range[0] * scale, maximum: range[1] * scale };
  }

  function virusSplitPlan(options = {}) {
    const big = Boolean(options.big);
    const player = Boolean(options.player);
    const cellMass = Math.max(0, finite(options.cellMass));
    const virusMass = Math.max(0, finite(options.virusMass, big ? 260 : 95));
    const totalMass = cellMass + virusMass * (big ? VIRUS_RULES.bigMassMultiplier : VIRUS_RULES.smallMassMultiplier);
    const available = Math.max(0, Math.floor(finite(options.available)));
    const minimumMass = big ? VIRUS_RULES.bigMinimumMass : VIRUS_RULES.smallMinimumMass;
    if (available < 2 || totalMass < minimumMass) {
      return Object.freeze({ split: false, totalMass, pieces: 1, pieceMass: totalMass });
    }

    const defaultCap = player
      ? (big ? VIRUS_RULES.playerBigPieces : VIRUS_RULES.playerSmallPieces)
      : (big ? VIRUS_RULES.botBigPieces : VIRUS_RULES.botSmallPieces);
    const requestedCap = player ? finite(options.playerPieceCap, defaultCap) : defaultCap;
    const pieceCap = Math.max(2, Math.floor(requestedCap));
    const pieceFloor = Math.min(pieceCap, player
      ? (big ? VIRUS_RULES.playerBigFloor : VIRUS_RULES.playerSmallFloor)
      : (big ? VIRUS_RULES.botBigFloor : VIRUS_RULES.botSmallFloor));
    const divisor = player
      ? (big ? VIRUS_RULES.playerBigDivisor : VIRUS_RULES.playerSmallDivisor)
      : (big ? VIRUS_RULES.botBigDivisor : VIRUS_RULES.botSmallDivisor);
    const pieces = Math.min(available, clamp(Math.floor(totalMass / divisor), pieceFloor, pieceCap));
    return Object.freeze({ split: true, totalMass, pieces, pieceMass: totalMass / pieces });
  }

  function sporeBurstPlan(options = {}) {
    const cellMass = Math.max(0, finite(options.cellMass));
    const minimumRatio = clamp(finite(options.lossMinimum, 0.5), 0, 1);
    const maximumRatio = clamp(finite(options.lossMaximum, minimumRatio), minimumRatio, 1);
    const pressure = clamp(
      (cellMass - VIRUS_RULES.sporeMassPressureStart) / VIRUS_RULES.sporeMassPressureSpan,
      0,
      1
    );
    const lossRatio = minimumRatio + (maximumRatio - minimumRatio) * pressure;
    const maximumLoss = Math.max(VIRUS_RULES.sporeMinimumLoss, cellMass - VIRUS_RULES.sporeMinimumRemainingMass);
    const loss = clamp(cellMass * lossRatio, VIRUS_RULES.sporeMinimumLoss, maximumLoss);
    const canBurst = loss > 0 && cellMass - loss >= VIRUS_RULES.sporeMinimumRemainingMass / 2;
    if (!canBurst) return Object.freeze({ canBurst: false, lossRatio, loss: 0, pieces: 0, pieceMass: 0 });
    const minimumPieces = Math.max(1, Math.floor(finite(options.minimumPieces, 16)));
    const maximumPieces = Math.max(minimumPieces, Math.floor(finite(options.maximumPieces, 30)));
    const targetPieceMass = Math.max(1, finite(options.pieceMass, 17));
    const pieces = Math.floor(clamp(loss / targetPieceMass, minimumPieces, maximumPieces));
    return Object.freeze({ canBurst: true, lossRatio, loss, pieces, pieceMass: loss / Math.max(1, pieces) });
  }

  function canCollectEjected(options = {}) {
    const ageSeconds = Math.max(0, finite(options.ageSeconds));
    if (options.sameOwner && ageSeconds < (options.playerOwned
      ? VIRUS_RULES.ownerHumanPickupSeconds
      : VIRUS_RULES.ownerBotPickupSeconds)) return false;
    if (!options.sameOwner && options.playerOwned && ageSeconds < VIRUS_RULES.playerOwnedOpponentPickupSeconds) return false;
    if (!options.sameOwner && ageSeconds < VIRUS_RULES.otherPickupSeconds) return false;
    const reach = Math.max(0, finite(options.cellRadius))
      + Math.max(0, finite(options.itemRadius)) * VIRUS_RULES.pickupRadiusMultiplier;
    return Math.max(0, finite(options.distanceSquared, Infinity)) < reach * reach;
  }

  function virusBaseMass(kind, explicitBaseMass) {
    const explicit = Number(explicitBaseMass);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    if (kind === "big") return VIRUS_FEED.bigBaseMass;
    if (kind === "spore") return VIRUS_FEED.smallBaseMass * VIRUS_FEED.sporeBaseMassMultiplier;
    return VIRUS_FEED.smallBaseMass;
  }

  function ejectedHitsVirus(item, virus) {
    const dx = finite(item?.x) - finite(virus?.x);
    const dy = finite(item?.y) - finite(virus?.y);
    const reach = Math.max(0, finite(virus?.radius))
      + Math.max(0, finite(item?.radius)) * VIRUS_FEED.collisionRadiusMultiplier;
    return dx * dx + dy * dy < reach * reach;
  }

  function virusFeedPlan(options = {}) {
    const kind = options.kind === "big" ? "big" : options.kind === "spore" ? "spore" : "small";
    const big = kind === "big";
    const baseMass = virusBaseMass(kind, options.baseMass);
    const currentMass = Math.max(baseMass, finite(options.currentMass, baseMass));
    const ejectedMass = Math.max(0, finite(options.ejectedMass));
    const gainedMass = ejectedMass * (big
      ? VIRUS_FEED.bigMassGainMultiplier
      : VIRUS_FEED.smallMassGainMultiplier);
    const nextMass = currentMass + gainedMass;
    const threshold = baseMass + (big
      ? VIRUS_FEED.bigLaunchThreshold
      : VIRUS_FEED.smallLaunchThreshold);
    return Object.freeze({
      kind,
      big,
      baseMass,
      gainedMass,
      nextMass,
      threshold,
      shouldLaunch: nextMass > threshold
    });
  }

  function virusLaunchPlan(options = {}) {
    const virus = options.virus || {};
    const seed = options.seed || {};
    const kind = virus.kind === "big" ? "big" : virus.kind === "spore" ? "spore" : "small";
    const big = kind === "big";
    const baseMass = virusBaseMass(kind, options.baseMass ?? virus.baseMass);
    const direction = directionToTarget(seed, virus);
    const pushX = direction.distance > 0 ? direction.x : 1;
    const pushY = direction.distance > 0 ? direction.y : 0;
    const offset = Math.max(0, finite(options.offset, VIRUS_FEED.launchOffset));
    const speed = big ? VIRUS_FEED.bigLaunchSpeed : VIRUS_FEED.smallLaunchSpeed;
    const bigRadius = clamp(
      finite(options.bigRadius, (VIRUS_FEED.bigRadiusMinimum + VIRUS_FEED.bigRadiusMaximum) / 2),
      VIRUS_FEED.bigRadiusMinimum,
      VIRUS_FEED.bigRadiusMaximum
    );
    return Object.freeze({
      x: clamp(finite(virus.x) + pushX * offset, finite(options.minimumX, 120), finite(options.maximumX, 5080)),
      y: clamp(finite(virus.y) + pushY * offset, finite(options.minimumY, 120), finite(options.maximumY, 5080)),
      vx: pushX * speed,
      vy: pushY * speed,
      radius: big ? bigRadius : Math.max(4, finite(virus.radius, 42) * VIRUS_FEED.smallRadiusMultiplier),
      mass: baseMass,
      baseMass,
      kind,
      launched: true,
      ageSeconds: 0
    });
  }

  function advanceLaunchedVirus(virus, dt) {
    const seconds = clamp(finite(dt), 0, 0.1);
    const ageSeconds = Math.max(0, finite(virus?.ageSeconds)) + seconds;
    const drag = Math.pow(VIRUS_FEED.launchedDragPer60Hz, seconds * 60);
    const vx = finite(virus?.vx) * drag;
    const vy = finite(virus?.vy) * drag;
    const launched = ageSeconds <= VIRUS_FEED.launchedLifetimeSeconds;
    return Object.freeze({
      x: finite(virus?.x) + finite(virus?.vx) * seconds,
      y: finite(virus?.y) + finite(virus?.vy) * seconds,
      vx: launched ? vx : 0,
      vy: launched ? vy : 0,
      ageSeconds,
      launched
    });
  }

  function directionToTarget(cell, target) {
    const dx = finite(target?.x, finite(cell?.x)) - finite(cell?.x);
    const dy = finite(target?.y, finite(cell?.y)) - finite(cell?.y);
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-9) return { dx: 0, dy: 0, x: 0, y: 0, distance: 0 };
    return { dx, dy, x: dx / distance, y: dy / distance, distance };
  }

  function targetFromInput(input, origin, fallbackDistance = MOVEMENT.fullSpeedDistance) {
    const originX = finite(origin?.x);
    const originY = finite(origin?.y);
    const targetX = Number(input?.targetX);
    const targetY = Number(input?.targetY);
    if (Number.isFinite(targetX) && Number.isFinite(targetY)) return { x: targetX, y: targetY };

    let dx = finite(input?.dx);
    let dy = finite(input?.dy);
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    const distance = Math.max(1, finite(fallbackDistance, MOVEMENT.fullSpeedDistance));
    return { x: originX + dx * distance, y: originY + dy * distance };
  }

  function movementStep(cell, target, dt, options = {}) {
    const seconds = clamp(finite(dt), 0, 0.1);
    const direction = directionToTarget(cell, target);
    const fullSpeedDistance = Math.max(1, finite(options.fullSpeedDistance, MOVEMENT.fullSpeedDistance));
    const minimumDistanceScale = clamp(
      finite(options.minimumDistanceScale, MOVEMENT.minimumDistanceScale),
      0,
      1
    );
    const distanceScale = clamp(direction.distance / fullSpeedDistance, minimumDistanceScale, 1);
    const radius = Math.max(0, finite(cell?.radius, radiusFromMass(cell?.mass)));
    const speedNumerator = finite(options.speedNumerator, MOVEMENT.speedNumerator);
    const radiusDivisor = Math.max(1, finite(options.radiusDivisor, MOVEMENT.radiusDivisor));
    const speedScale = Math.max(0, finite(options.speedScale, 1));
    const baseSpeed = speedNumerator / (1 + radius / radiusDivisor) * speedScale;
    const desiredVx = direction.x * baseSpeed * distanceScale;
    const desiredVy = direction.y * baseSpeed * distanceScale;
    const steerRate = Math.max(0, finite(options.steerRate, MOVEMENT.playerSteerRate));
    const steer = 1 - Math.exp(-steerRate * seconds);
    const dragPer60Hz = clamp(finite(options.dragPer60Hz, MOVEMENT.dragPer60Hz), 0, 1);
    const drag = Math.pow(dragPer60Hz, seconds * 60);
    const vx = (finite(cell?.vx) + (desiredVx - finite(cell?.vx)) * steer) * drag;
    const vy = (finite(cell?.vy) + (desiredVy - finite(cell?.vy)) * steer) * drag;

    return {
      x: finite(cell?.x) + vx * seconds,
      y: finite(cell?.y) + vy * seconds,
      vx,
      vy,
      baseSpeed,
      distanceScale,
      targetDistance: direction.distance
    };
  }

  function applyMovement(cell, target, dt, options = {}) {
    const next = movementStep(cell, target, dt, options);
    cell.x = next.x;
    cell.y = next.y;
    cell.vx = next.vx;
    cell.vy = next.vy;
    return next;
  }

  function splitVelocity(cell, target, power = 1, impulse = MOVEMENT.splitImpulse) {
    const direction = directionToTarget(cell, target);
    const safeX = direction.distance > 0 ? direction.x : 1;
    const safeY = direction.distance > 0 ? direction.y : 0;
    const amount = Math.max(0, finite(impulse, MOVEMENT.splitImpulse)) * Math.max(0, finite(power, 1));
    return {
      x: safeX,
      y: safeY,
      vx: finite(cell?.vx) + safeX * amount,
      vy: finite(cell?.vy) + safeY * amount
    };
  }

  function advanceRenderCadence(now, nextRenderAt, interval, tolerance = 0.2) {
    const current = Math.max(0, finite(now));
    const frameInterval = Math.max(0.1, finite(interval, 1000 / 60));
    const earlyTolerance = clamp(finite(tolerance, 0.2), 0, frameInterval * 0.25);
    let deadline = Math.max(0, finite(nextRenderAt));

    if (deadline === 0 || current - deadline > frameInterval * 4) {
      return { due: true, nextRenderAt: current + frameInterval };
    }
    if (current + earlyTolerance < deadline) return { due: false, nextRenderAt: deadline };

    do deadline += frameInterval;
    while (deadline <= current + earlyTolerance);
    return { due: true, nextRenderAt: deadline };
  }

  function renderBudgetFor(refreshRate) {
    const refresh = clamp(finite(refreshRate, 60), 60, 240);
    return Math.round(refresh);
  }

  function gpuPixelRatioCeiling(rendererDevice = "") {
    const device = String(rendererDevice || "");
    const discrete = /NVIDIA.*(?:RTX|GTX|Quadro)|Radeon.*RX|Intel.*Arc/i.test(device);
    return discrete ? 0.9 : 0.75;
  }

  const api = Object.freeze({
    MOVEMENT,
    MODE_SPEED,
    VIRUS_RULES,
    VIRUS_FEED,
    clamp,
    finite,
    radiusFromMass,
    mergeCooldownSeconds,
    botStartMassRange,
    virusSplitPlan,
    sporeBurstPlan,
    canCollectEjected,
    virusBaseMass,
    ejectedHitsVirus,
    virusFeedPlan,
    virusLaunchPlan,
    advanceLaunchedVirus,
    directionToTarget,
    targetFromInput,
    movementStep,
    applyMovement,
    splitVelocity,
    advanceRenderCadence,
    renderBudgetFor,
    gpuPixelRatioCeiling
  });

  globalScope.ScaGameplayCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
