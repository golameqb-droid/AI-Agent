(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── 3D click & hover for all interactive elements ── */
  function spawnBurst(el, e, isPrimary) {
    const burst = document.createElement("span");
    burst.className = `lp-click-burst ${isPrimary ? "primary" : "default"}`;
    const r = el.getBoundingClientRect();
    burst.style.left = `${e.clientX - r.left}px`;
    burst.style.top = `${e.clientY - r.top}px`;
    el.appendChild(burst);
    burst.addEventListener("animationend", () => burst.remove());
  }

  function spawnSparks(x, y, isPrimary) {
    const colors = isPrimary
      ? ["#c4b5fd", "#8b5cf6", "#06b6d4", "#f0abfc", "#fff"]
      : ["#8b5cf6", "#06b6d4", "#a78bfa"];
    for (let i = 0; i < 8; i++) {
      const s = document.createElement("span");
      s.className = "lp-spark";
      s.style.left = `${x}px`;
      s.style.top = `${y}px`;
      s.style.background = colors[i % colors.length];
      const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.5;
      const dist = 40 + Math.random() * 50;
      s.style.setProperty("--sx", `${Math.cos(angle) * dist}px`);
      s.style.setProperty("--sy", `${Math.sin(angle) * dist}px`);
      document.body.appendChild(s);
      s.addEventListener("animationend", () => s.remove());
    }
  }

  function bind3DButton(el) {
    if (el.dataset.lp3d) return;
    el.dataset.lp3d = "1";
    el.classList.add("lp-3d-active");
    const isPrimary = el.classList.contains("lp-btn-primary");
    const maxTilt = el.classList.contains("lp-btn-lg") ? 16 : 12;
    let pressing = false;
    let tiltX = 0;
    let tiltY = 0;

    const setTransform = (rx, ry, z, scale) => {
      el.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(${z}px) scale(${scale})`;
    };

    el.addEventListener("mousemove", (e) => {
      if (pressing || reducedMotion) return;
      const r = el.getBoundingClientRect();
      tiltX = ((e.clientX - r.left) / r.width - 0.5) * maxTilt;
      tiltY = -((e.clientY - r.top) / r.height - 0.5) * maxTilt;
      setTransform(tiltY * 0.6, tiltX, 10, 1);
    });

    el.addEventListener("mouseleave", () => {
      if (pressing) return;
      el.style.transform = "";
      tiltX = tiltY = 0;
    });

    const press = (e) => {
      pressing = true;
      el.classList.add("lp-3d-pressing");
      setTransform(14, tiltX * 0.5, -10, 0.92);
      if (e.type === "mousedown" || e.type === "touchstart") {
        const pt = e.touches ? e.touches[0] : e;
        spawnBurst(el, pt, isPrimary);
        if (isPrimary) spawnSparks(pt.clientX, pt.clientY, true);
      }
    };

    const release = () => {
      if (!pressing) return;
      pressing = false;
      el.classList.remove("lp-3d-pressing");
      el.classList.remove("lp-3d-pop");
      void el.offsetWidth;
      el.classList.add("lp-3d-pop");
      el.addEventListener("animationend", () => {
        el.classList.remove("lp-3d-pop");
        el.style.transform = "";
      }, { once: true });
    };

    el.addEventListener("mousedown", press);
    el.addEventListener("mouseup", release);
    el.addEventListener("mouseleave", release);
    el.addEventListener("touchstart", press, { passive: true });
    el.addEventListener("touchend", release);
  }

  function bind3DCard(el, intensity = 8) {
    if (el.dataset.lp3dCard) return;
    el.dataset.lp3dCard = "1";
    el.classList.add("lp-3d-card");
    let pressing = false;

    el.addEventListener("mousemove", (e) => {
      if (pressing || reducedMotion) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateY(${x * intensity}deg) rotateX(${-y * intensity}deg) translateZ(6px)`;
    });

    el.addEventListener("mouseleave", () => {
      if (!pressing) el.style.transform = "";
    });

    el.addEventListener("mousedown", (e) => {
      pressing = true;
      el.classList.add("lp-3d-pressing");
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateX(${8 + y * 4}deg) rotateY(${x * 4}deg) scale(0.97) translateZ(-4px)`;
    });

    el.addEventListener("mouseup", () => {
      pressing = false;
      el.classList.remove("lp-3d-pressing");
      el.classList.add("lp-3d-pop");
      el.addEventListener("animationend", () => {
        el.classList.remove("lp-3d-pop");
        el.style.transform = "";
      }, { once: true });
    });
    el.addEventListener("mouseleave", () => {
      pressing = false;
      el.classList.remove("lp-3d-pressing");
    });
  }

  function bind3DNavLink(el) {
    if (el.dataset.lp3dNav) return;
    el.dataset.lp3dNav = "1";
    el.addEventListener("mousedown", () => {
      el.style.transform = "perspective(400px) rotateX(8deg) scale(0.95)";
    });
    const reset = () => { el.style.transform = ""; };
    el.addEventListener("mouseup", reset);
    el.addEventListener("mouseleave", reset);
  }

  function init3DInteractions(root = document) {
    if (reducedMotion) return;
    root.querySelectorAll(".lp-btn, .lp-menu, .lp-faq-q").forEach(bind3DButton);
    root.querySelectorAll(".lp-nav-links a, .lp-mobile a").forEach(bind3DNavLink);
    root.querySelectorAll(".lp-card, .lp-feat, .lp-step, .lp-price-card, .lp-case, .lp-stat, .lp-cta-band").forEach((el) => bind3DCard(el, 6));
    root.querySelectorAll(".lp-pill").forEach((el) => bind3DButton(el));
  }

  const nav = document.getElementById("lpNav");
  if (nav) {
    window.addEventListener("scroll", () => {
      nav.classList.toggle("is-scrolled", window.scrollY > 20);
    }, { passive: true });
  }

  const menu = document.getElementById("lpMenu");
  const mobile = document.getElementById("lpMobile");
  menu?.addEventListener("click", () => {
    mobile?.classList.toggle("is-open");
  });

  document.querySelectorAll(".lp-faq-item, .faq-item").forEach((item) => {
    const btn = item.querySelector(".lp-faq-q, .faq-q");
    btn?.addEventListener("click", () => {
      const open = item.classList.contains("open");
      document.querySelectorAll(".lp-faq-item, .faq-item").forEach((i) => i.classList.remove("open"));
      if (!open) item.classList.add("open");
    });
  });

  const revealObs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        revealObs.unobserve(e.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  document.querySelectorAll(".lp-reveal, .lp-stagger").forEach((el) => revealObs.observe(el));

  /* Product 3D tilt on mouse */
  const frame = document.getElementById("lpProductFrame");
  const product = document.getElementById("showcase");
  if (frame && product) {
    const tilt = { x: 0, y: 0 };
    const lerp = (a, b, t) => a + (b - a) * t;

    product.addEventListener("mousemove", (e) => {
      const r = product.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tilt.x = px * 10;
      tilt.y = -py * 8;
    });
    product.addEventListener("mouseleave", () => {
      tilt.x = 0;
      tilt.y = 0;
    });

    const animateTilt = () => {
      const cur = frame._tilt || { x: 0, y: 0 };
      const nx = lerp(cur.x, tilt.x, 0.08);
      const ny = lerp(cur.y, tilt.y, 0.08);
      frame._tilt = { x: nx, y: ny };
      const scrollY = Math.min(1, Math.max(0, (window.scrollY - product.offsetTop + 200) / 400));
      const scrollTilt = scrollY * 4;
      frame.style.transform = `perspective(1200px) rotateY(${nx}deg) rotateX(${ny + scrollTilt}deg)`;
      requestAnimationFrame(animateTilt);
    };
    if (!reducedMotion) {
      requestAnimationFrame(animateTilt);
    }

    product.addEventListener("click", (e) => {
      if (reducedMotion) return;
      spawnSparks(e.clientX, e.clientY, true);
      frame.classList.remove("lp-3d-pop");
      void frame.offsetWidth;
      frame.classList.add("lp-3d-pop");
      frame.addEventListener("animationend", () => frame.classList.remove("lp-3d-pop"), { once: true });
    });
  }

  document.querySelectorAll(".lp-logo").forEach((el) => bind3DButton(el));

  init3DInteractions();

  /* Stat counter animation */
  const statsEl = document.getElementById("lpStats");
  if (statsEl) {
    const statObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.querySelectorAll(".lp-stat strong").forEach((el) => {
            const raw = el.textContent.trim();
            const match = raw.match(/^(\d+)/);
            if (match) {
              const end = parseInt(match[1], 10);
              const suffix = raw.slice(match[1].length);
              const start = performance.now();
              const dur = 1400;
              const tick = (now) => {
                const p = Math.min(1, (now - start) / dur);
                const ease = 1 - Math.pow(1 - p, 3);
                el.textContent = Math.round(end * ease) + suffix;
                if (p < 1) requestAnimationFrame(tick);
                else el.classList.add("is-counted");
              };
              requestAnimationFrame(tick);
            } else {
              el.classList.add("is-counted");
            }
          });
          statObs.unobserve(e.target);
        });
      },
      { threshold: 0.4 }
    );
    statObs.observe(statsEl);
  }

  /* Smooth anchor scroll */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      mobile?.classList.remove("is-open");
    });
  });

  const esc = (s) =>
    (s ?? "").toString().replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const grid = document.getElementById("landingPricing");
  if (grid && grid.classList.contains("lp-pricing")) {
    fetch("/api/billing/plans")
      .then((r) => r.json())
      .then((data) => {
        const plans = (data.plans || []).filter((p) => p.id !== "trial");
        if (!plans.length) return;
        grid.innerHTML = plans
          .map(
            (p) => `
          <article class="lp-price-card ${p.popular ? "featured" : ""}">
            ${p.popular ? '<div class="lp-price-badge">Most popular</div>' : ""}
            <h3>${esc(p.name)}</h3>
            <div class="lp-price">${esc(p.priceLabel)} <small>/mo</small></div>
            <p class="lp-price-sub">${esc(p.subtitle)}</p>
            <ul class="lp-price-features">
              ${p.features.slice(0, 5).map((f) => `<li>${esc(f)}</li>`).join("")}
            </ul>
            <a href="${p.id === "enterprise" ? "mailto:sales@socialai.pro" : "/app#register"}" class="lp-btn ${p.popular ? "lp-btn-primary" : "lp-btn-outline"}" style="width:100%">${p.id === "enterprise" ? "Contact sales" : "Start free trial"}</a>
          </article>`
          )
          .join("");
        grid.classList.remove("in");
        revealObs.observe(grid);
        init3DInteractions(grid);
      })
      .catch(() => {});
  }
})();
