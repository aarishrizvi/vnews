'use client';

import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  r: number;
  pulse: number;
  connections: number[];
}

interface Signal {
  from: number;
  to: number;
  progress: number;
  speed: number;
}

const GREEN = '#85E128';
const BRIGHT_GREEN = '#B8FF70';

export function InvestigationField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  const pointerRef = useRef({
    x: -9999,
    y: -9999,
    active: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    let width = 0;
    let height = 0;

    let nodes: Node[] = [];
    let signals: Signal[] = [];

    let lastTime = performance.now();
    let lastIdleSignal = 0;

    /* ─────────────────────────────────────────
       RESIZE
    ───────────────────────────────────────── */

    const resize = () => {
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        2
      );

      width = canvas.clientWidth;
      height = canvas.clientHeight;

      if (!width || !height) return;

      canvas.width = width * dpr;
      canvas.height = height * dpr;

      ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
      );

      createNetwork();
    };

    /* ─────────────────────────────────────────
       CONNECTED RANDOM NETWORK
       
       IMPORTANT:
       The network is deliberately MUCH larger
       than the visible canvas.
    ───────────────────────────────────────── */

    const createNetwork = () => {
      nodes = [];
      signals = [];

      const mobile = width < 700;

      /*
       * How far the virtual network extends
       * beyond the actual screen.
       *
       * 0.55 means 55% beyond every edge.
       */
      const overflowX = width * 0.55;
      const overflowY = height * 0.55;

      /*
       * The actual virtual area.
       */
      const worldLeft = -overflowX;
      const worldRight = width + overflowX;

      const worldTop = -overflowY;
      const worldBottom = height + overflowY;

      const worldWidth =
        worldRight - worldLeft;

      const worldHeight =
        worldBottom - worldTop;

      /*
       * More nodes because the world itself
       * is much larger than the viewport.
       */
      const nodeCount = mobile
        ? 30
        : Math.min(
          85,
          Math.max(
            55,
            Math.floor(
              (worldWidth * worldHeight) /
              48000
            )
          )
        );

      /*
       * Generate random nodes throughout the
       * oversized virtual world.
       */
      for (
        let i = 0;
        i < nodeCount;
        i++
      ) {
        nodes.push({
          x:
            worldLeft +
            Math.random() *
            worldWidth,

          y:
            worldTop +
            Math.random() *
            worldHeight,

          r: mobile
            ? 2.8 +
            Math.random() * 1.5
            : 3 +
            Math.random() * 1.8,

          pulse:
            Math.random() *
            Math.PI *
            2,

          connections: [],
        });
      }

      if (nodes.length < 2) return;

      /*
       * ─────────────────────────────────────
       * STEP 1
       * GUARANTEE CONNECTIVITY
       *
       * Every node connects to an existing
       * node. Therefore there can never be
       * disconnected islands.
       * ─────────────────────────────────────
       */

      for (
        let i = 1;
        i < nodes.length;
        i++
      ) {
        const candidates: {
          index: number;
          distance: number;
        }[] = [];

        for (
          let j = 0;
          j < i;
          j++
        ) {
          const dx =
            nodes[i].x -
            nodes[j].x;

          const dy =
            nodes[i].y -
            nodes[j].y;

          const distance =
            Math.hypot(
              dx,
              dy
            );

          candidates.push({
            index: j,
            distance,
          });
        }

        candidates.sort(
          (a, b) =>
            a.distance -
            b.distance
        );

        /*
         * Pick one of the nearest several
         * nodes rather than always the closest.
         */
        const poolSize = Math.min(
          5,
          candidates.length
        );

        const selected =
          candidates[
          Math.floor(
            Math.random() *
            poolSize
          )
          ];

        if (!selected) continue;

        const target =
          selected.index;

        nodes[i].connections.push(
          target
        );

        nodes[target].connections.push(
          i
        );
      }

      /*
       * ─────────────────────────────────────
       * STEP 2
       * EXTRA RANDOM CONNECTIONS
       * ─────────────────────────────────────
       */

      const extraChance =
        mobile
          ? 0.16
          : 0.22;

      const maxDistance =
        Math.min(
          worldWidth,
          worldHeight
        ) * 0.22;

      for (
        let i = 0;
        i < nodes.length;
        i++
      ) {
        for (
          let j = i + 1;
          j < nodes.length;
          j++
        ) {
          /*
           * Already connected.
           */
          if (
            nodes[i].connections.includes(
              j
            )
          ) {
            continue;
          }

          const dx =
            nodes[i].x -
            nodes[j].x;

          const dy =
            nodes[i].y -
            nodes[j].y;

          const distance =
            Math.hypot(
              dx,
              dy
            );

          if (
            distance <
            maxDistance &&
            Math.random() <
            extraChance
          ) {
            nodes[i].connections.push(
              j
            );

            nodes[j].connections.push(
              i
            );
          }
        }
      }
    };

    /* ─────────────────────────────────────────
       FIND NODE
    ───────────────────────────────────────── */

    const findNode = (
      x: number,
      y: number
    ): number | null => {
      let closest: number | null =
        null;

      let closestDistance = 45;

      for (
        let i = 0;
        i < nodes.length;
        i++
      ) {
        const distance =
          Math.hypot(
            nodes[i].x - x,
            nodes[i].y - y
          );

        if (
          distance <
          closestDistance
        ) {
          closestDistance =
            distance;

          closest = i;
        }
      }

      return closest;
    };

    /* ─────────────────────────────────────────
       SIGNAL
    ───────────────────────────────────────── */

    const createSignal = (
      from: number,
      to: number,
      idle = false
    ) => {
      if (
        !nodes[from] ||
        !nodes[to]
      ) {
        return;
      }

      /*
       * Only one moving signal at a time.
       * Prevents performance problems.
       */
      if (signals.length > 0) {
        return;
      }

      signals.push({
        from,
        to,
        progress: 0,

        speed: idle
          ? 0.0005
          : 0.006,
      });
    };

    /* ─────────────────────────────────────────
       NODE CLICK / TOUCH
    ───────────────────────────────────────── */

    const triggerNode = (
      index: number
    ) => {
      const node =
        nodes[index];

      if (
        !node ||
        node.connections.length === 0
      ) {
        return;
      }

      if (signals.length > 0) {
        return;
      }

      /*
       * One node → one random connection.
       */
      const target =
        node.connections[
        Math.floor(
          Math.random() *
          node.connections.length
        )
        ];

      createSignal(
        index,
        target,
        false
      );
    };

    /* ─────────────────────────────────────────
       SLOW IDLE SIGNAL
    ───────────────────────────────────────── */

    const createIdleSignal = () => {
      if (
        reducedMotion ||
        signals.length > 0 ||
        nodes.length === 0
      ) {
        return;
      }

      const start =
        Math.floor(
          Math.random() *
          nodes.length
        );

      const node =
        nodes[start];

      if (
        !node ||
        node.connections.length === 0
      ) {
        return;
      }

      const target =
        node.connections[
        Math.floor(
          Math.random() *
          node.connections.length
        )
        ];

      createSignal(
        start,
        target,
        true
      );
    };

    /* ─────────────────────────────────────────
       DRAW
    ───────────────────────────────────────── */

    const draw = (
      time: number
    ) => {
      const delta =
        Math.min(
          time - lastTime,
          50
        );

      lastTime = time;

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      /*
       * Slow idle activity.
       */
      if (
        !reducedMotion &&
        time - lastIdleSignal >
        3500
      ) {
        createIdleSignal();

        lastIdleSignal = time;
      }

      /* ─────────────────────────────────────
         CONNECTIONS
      ───────────────────────────────────── */

      for (
        let i = 0;
        i < nodes.length;
        i++
      ) {
        const node =
          nodes[i];

        for (
          let c = 0;
          c <
          node.connections.length;
          c++
        ) {
          const targetIndex =
            node.connections[c];

          /*
           * Draw each connection once.
           */
          if (
            targetIndex < i
          ) {
            continue;
          }

          const target =
            nodes[targetIndex];

          if (!target) continue;

          /*
           * Canvas automatically clips this.
           *
           * This is what allows a line to start
           * outside the screen and enter the frame.
           */
          ctx.beginPath();

          ctx.strokeStyle =
            'rgba(133,225,40,0.38)';

          ctx.lineWidth = 1;

          ctx.moveTo(
            node.x,
            node.y
          );

          ctx.lineTo(
            target.x,
            target.y
          );

          ctx.stroke();
        }
      }

      /* ─────────────────────────────────────
         HOVER GLOW
      ───────────────────────────────────── */

      const pointer =
        pointerRef.current;

      for (
        const node of nodes
      ) {
        const distance =
          Math.hypot(
            node.x -
            pointer.x,
            node.y -
            pointer.y
          );

        if (
          pointer.active &&
          distance < 65
        ) {
          ctx.beginPath();

          ctx.fillStyle =
            'rgba(133,225,40,0.20)';

          ctx.arc(
            node.x,
            node.y,
            17,
            0,
            Math.PI * 2
          );

          ctx.fill();
        }
      }

      /* ─────────────────────────────────────
         MOVING SIGNAL
      ───────────────────────────────────── */

      for (
        let i =
          signals.length - 1;
        i >= 0;
        i--
      ) {
        const signal =
          signals[i];

        const from =
          nodes[signal.from];

        const to =
          nodes[signal.to];

        if (
          !from ||
          !to
        ) {
          signals.splice(i, 1);
          continue;
        }

        signal.progress +=
          signal.speed *
          delta;

        if (
          signal.progress >= 1
        ) {
          signals.splice(i, 1);
          continue;
        }

        const progress =
          signal.progress;

        const trail =
          signal.speed <
            0.001
            ? 0.20
            : 0.32;

        const tailProgress =
          Math.max(
            0,
            progress - trail
          );

        const headX =
          from.x +
          (to.x - from.x) *
          progress;

        const headY =
          from.y +
          (to.y - from.y) *
          progress;

        const tailX =
          from.x +
          (to.x - from.x) *
          tailProgress;

        const tailY =
          from.y +
          (to.y - from.y) *
          tailProgress;

        const gradient =
          ctx.createLinearGradient(
            tailX,
            tailY,
            headX,
            headY
          );

        gradient.addColorStop(
          0,
          'rgba(133,225,40,0)'
        );

        gradient.addColorStop(
          0.4,
          'rgba(133,225,40,0.55)'
        );

        gradient.addColorStop(
          0.8,
          'rgba(133,225,40,0.9)'
        );

        gradient.addColorStop(
          1,
          'rgba(184,255,112,1)'
        );

        ctx.beginPath();

        ctx.strokeStyle =
          gradient;

        ctx.lineWidth =
          signal.speed <
            0.001
            ? 2
            : 3;

        ctx.moveTo(
          tailX,
          tailY
        );

        ctx.lineTo(
          headX,
          headY
        );

        ctx.stroke();

        /*
         * Bright moving node.
         */
        ctx.beginPath();

        ctx.fillStyle =
          BRIGHT_GREEN;

        ctx.shadowColor =
          GREEN;

        ctx.shadowBlur = 14;

        ctx.arc(
          headX,
          headY,
          signal.speed <
            0.001
            ? 3
            : 4,
          0,
          Math.PI * 2
        );

        ctx.fill();

        ctx.shadowBlur = 0;
      }

      /* ─────────────────────────────────────
         NODES
      ───────────────────────────────────── */

      for (
        const node of nodes
      ) {
        node.pulse +=
          0.012;

        const breathing =
          1 +
          Math.sin(
            node.pulse
          ) *
          0.08;

        /*
         * Glow.
         */
        ctx.beginPath();

        ctx.fillStyle =
          'rgba(133,225,40,0.17)';

        ctx.arc(
          node.x,
          node.y,
          node.r * 2.8,
          0,
          Math.PI * 2
        );

        ctx.fill();

        /*
         * Node.
         */
        ctx.beginPath();

        ctx.fillStyle =
          GREEN;

        ctx.arc(
          node.x,
          node.y,
          node.r *
          breathing,
          0,
          Math.PI * 2
        );

        ctx.fill();

        /*
         * Highlight.
         */
        ctx.beginPath();

        ctx.fillStyle =
          'rgba(255,255,255,0.85)';

        ctx.arc(
          node.x - 1,
          node.y - 1,
          0.8,
          0,
          Math.PI * 2
        );

        ctx.fill();
      }

      animationRef.current =
        requestAnimationFrame(
          draw
        );
    };

    /* ─────────────────────────────────────────
       POINTER
    ───────────────────────────────────────── */

    const handlePointerMove = (
      event: PointerEvent
    ) => {
      const rect =
        canvas.getBoundingClientRect();

      pointerRef.current = {
        x:
          event.clientX -
          rect.left,

        y:
          event.clientY -
          rect.top,

        active: true,
      };
    };

    const handlePointerDown = (
      event: PointerEvent
    ) => {
      const rect =
        canvas.getBoundingClientRect();

      const x =
        event.clientX -
        rect.left;

      const y =
        event.clientY -
        rect.top;

      const node =
        findNode(x, y);

      if (
        node !== null
      ) {
        triggerNode(node);
      }
    };

    const handlePointerLeave =
      () => {
        pointerRef.current = {
          x: -9999,
          y: -9999,
          active: false,
        };
      };

    /* ─────────────────────────────────────────
       OBSERVERS
    ───────────────────────────────────────── */

    const resizeObserver =
      new ResizeObserver(
        resize
      );

    resizeObserver.observe(
      canvas
    );

    window.addEventListener(
      'pointermove',
      handlePointerMove,
      { passive: true }
    );

    window.addEventListener(
      'pointerdown',
      handlePointerDown
    );

    window.addEventListener(
      'pointerleave',
      handlePointerLeave
    );

    resize();

    animationRef.current =
      requestAnimationFrame(
        draw
      );

    return () => {
      if (
        animationRef.current !==
        null
      ) {
        cancelAnimationFrame(
          animationRef.current
        );
      }

      resizeObserver.disconnect();

      window.removeEventListener(
        'pointermove',
        handlePointerMove
      );

      window.removeEventListener(
        'pointerdown',
        handlePointerDown
      );

      window.removeEventListener(
        'pointerleave',
        handlePointerLeave
      );
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full z-0 pointer-events-none"
      style={{
        touchAction: 'none',
      }}
      aria-hidden="true"
    />
  );
}