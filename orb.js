// 点阵小球：斐波那契球面上均匀撒点，绕竖轴自转、带一点俯角；离你越近的点越大越亮，远的点淡下去，看起来就是一颗在转的点云球
// 所有小球共用一个 requestAnimationFrame 循环，不在页面上（被删掉 / 隐藏）的不画；颜色取画布自身的 color，跟着深浅色走
//
// 性能优化（视觉基本不变）：
// 1. 原来每帧跑 96 次 arc + 96 次 fill。这里改成预渲染精灵图：俯角量化成 6 档烘进球图，
//    自转变成整张图绕中心的一次 2D 旋转（1 次 drawImage 代替 192 次绘图指令）。
// 2. 页面隐藏 / 减少动态效果时停掉 rAF，不在后台空转。

const N = 96;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const PTS = Array.from({ length: N }, (_, i) => {
    const y = 1 - (i + 0.5) * 2 / N;
    const r = Math.sqrt(1 - y * y);
    return [Math.cos(i * GOLDEN) * r, y, Math.sin(i * GOLDEN) * r];
});

// 俯角在 0.30 ~ 0.54 之间缓慢摆动，量化成 6 档；跨档才重画一次精灵（一秒不到一次）
const TILT_STEPS = 6;
const TILT_MIN = 0.30, TILT_MAX = 0.54;

const live = new Set();
let raf = 0;
const still = () => document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

// 某个俯角下的球，按 0° 朝向烘成一张离屏画布（直接用物理像素画，避开逐帧 transform 开销）
function buildSprite(color, px, tiltStep) {
    const cv = document.createElement('canvas');
    cv.width = px; cv.height = px;
    const g = cv.getContext('2d');
    g.fillStyle = color;
    const tilt = TILT_MIN + (TILT_MAX - TILT_MIN) * (tiltStep / (TILT_STEPS - 1));
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const R = px * 0.42, mid = px / 2, dot = Math.max(0.55, px / 26);
    for (const [x, y, z] of PTS) {
        const y2 = y * ct - z * st, z2 = y * st + z * ct;
        const near = (z2 + 1) / 2; // 0 最远，1 最近
        g.globalAlpha = 0.14 + near * 0.86;
        g.beginPath();
        g.arc(mid + x * R, mid - y2 * R, dot * (0.45 + near * 0.75), 0, Math.PI * 2);
        g.fill();
    }
    g.globalAlpha = 1;
    return cv;
}

const spriteCache = new Map(); // `${color}|${px}|${tilt}` -> canvas
function sprite(color, px, tiltStep) {
    const key = `${color}|${px}|${tiltStep}`;
    const hit = spriteCache.get(key);
    if (hit) return hit;
    if (spriteCache.size > 48) spriteCache.clear();
    const s = buildSprite(color, px, tiltStep);
    spriteCache.set(key, s);
    return s;
}

function draw(c, t) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const size = c.clientWidth || 20;
    const px = Math.round(size * dpr);
    if (c.width !== px) { c.width = px; c.height = px; c._color = null; }
    // 换深浅色时 color 会变，隔一阵重新读一次就够了
    if (!c._color || (c._frame = (c._frame || 0) + 1) % 30 === 0) c._color = getComputedStyle(c).color;
    const g = c.getContext('2d');
    const a = t * 0.0011, tilt = 0.42 + Math.sin(t * 0.0004) * 0.12;
    const tiltStep = Math.round((tilt - TILT_MIN) / (TILT_MAX - TILT_MIN) * (TILT_STEPS - 1));
    const img = sprite(c._color, px, tiltStep);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    // 绕竖轴自转 = 整张精灵绕中心旋转（俯角已经烘进精灵）
    g.save();
    g.translate(px / 2, px / 2);
    g.rotate(a % (Math.PI * 2));
    g.drawImage(img, -px / 2, -px / 2);
    g.restore();
}

function loop(t) {
    raf = 0;
    for (const c of live) {
        if (!c.isConnected) { live.delete(c); continue; }
        if (c.offsetParent) draw(c, t);
    }
    if (live.size && !still() && !document.hidden) raf = requestAnimationFrame(loop);
}

export function makeOrb() {
    const c = document.createElement('canvas');
    c.className = 'ilg-orb';
    c.setAttribute('aria-hidden', 'true');
    live.add(c);
    // 先等它挂进页面拿到尺寸再画第一帧；减少动态效果时只画这一帧，球停在一个角度
    requestAnimationFrame(t => { draw(c, t); if (!raf && !still()) raf = requestAnimationFrame(loop); });
    return c;
}
