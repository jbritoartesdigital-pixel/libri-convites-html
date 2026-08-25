(() => {
  "use strict";

  const DEFAULTS = {
    schemaVersion: 1,
    modo: "cinematico",
    hostMidia: "https://midia.libriconvites.com.br",
    inicioMusica: 0,
    volumeMusica: 0.35,
    transicaoAudio: 260,
    tempoPular: 5000,
    versaoArquivos: "1",
    versaoMidia: "1",
    tema: {
      accent: "#D8765D",
      secondary: "#4AA852",
      deep: "#173F59",
      soft: "#F7FAFB"
    },
    botoes: {
      mapa: "ABRIR NO GOOGLE MAPS",
      waze: "ABRIR NO WAZE"
    },
    confirmacaoModo: "rsvp"
  };

  const state = {
    config: null,
    conviteAberto: false,
    finalAtivo: false,
    finalizando: false,
    somLigado: true,
    audioDisponivel: true,
    midiaAquecida: false,
    videoEstavaTocando: false,
    musicaEstavaTocando: false,
    videoRsvpEstavaTocando: false,
    timerPular: null,
    timerRsvpFallback: null,
    rafFim: null,
    rafAudio: null,
    ultimoAjusteSincronia: 0
  };

  const $ = (id) => document.getElementById(id);

  function mergeDeep(base, extra) {
    const out = { ...base };
    if (!extra || typeof extra !== "object") return out;
    for (const [key, value] of Object.entries(extra)) {
      if (
        value && typeof value === "object" && !Array.isArray(value) &&
        base[key] && typeof base[key] === "object" && !Array.isArray(base[key])
      ) {
        out[key] = mergeDeep(base[key], value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function fail(message) {
    document.body.innerHTML = `
      <div class="libri-erro">
        <div>
          <strong>Convite indisponÃ­vel</strong>
          <span>${escapeHtml(message)}</span>
        </div>
      </div>`;
    console.error("[Libri]", message);
  }

  async function loadConfig() {
    const configUrl = window.LIBRI_CONFIG_URL || "config.json";
    const response = await fetch(configUrl, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`NÃ£o foi possÃ­vel carregar ${configUrl} (${response.status}).`);
    }
    const raw = await response.json();
    return mergeDeep(DEFAULTS, raw);
  }

  function validateConfig(config) {
    const errors = [];
    if (!config.pastaCliente) errors.push("pastaCliente ausente");
    if (!config.videoArquivo) errors.push("videoArquivo ausente");
    if (!config.imagens?.capa) errors.push("imagens.capa ausente");
    if (!config.imagens?.final) errors.push("imagens.final ausente");
    if (!config.hotspotsFinal || typeof config.hotspotsFinal !== "object") {
      errors.push("hotspotsFinal ausente");
    }
    if (!['cinematico', 'loop'].includes(config.modo)) {
      errors.push(`modo invÃ¡lido: ${config.modo}`);
    }
    return errors;
  }

  function applyTheme(config) {
    const root = document.documentElement.style;
    root.setProperty("--libri-accent", config.tema?.accent || DEFAULTS.tema.accent);
    root.setProperty("--libri-secondary", config.tema?.secondary || DEFAULTS.tema.secondary);
    root.setProperty("--libri-deep", config.tema?.deep || DEFAULTS.tema.deep);
    root.setProperty("--libri-soft", config.tema?.soft || DEFAULTS.tema.soft);
  }

  function renderBase(config) {
    document.body.innerHTML = `
      <section id="libriFinalTela" class="libri-tela" aria-label="Convite final">
        <div class="libri-quadro">
          <img id="libriFinalImagem" class="libri-arte" alt="${escapeHtml(config.titulo || "Convite")}" draggable="false">
          <video id="libriVideoLoop" class="libri-arte" playsinline webkit-playsinline preload="metadata" disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback" hidden></video>
          <div id="libriHotspots"></div>
          <button id="libriControleSom" type="button" aria-label="Ligar ou desligar mÃºsica">
            <svg id="libriIconeSom" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4z"></path>
              <path d="M16 9.5c.8.7 1.2 1.5 1.2 2.5s-.4 1.8-1.2 2.5"></path>
              <path d="M18.5 7c1.5 1.3 2.3 3 2.3 5s-.8 3.7-2.3 5"></path>
            </svg>
            <svg id="libriIconeMudo" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4z"></path>
              <path d="M17 9l4 4"></path>
              <path d="M21 9l-4 4"></path>
            </svg>
          </button>
        </div>
      </section>

      <section id="libriVideoTela" class="libri-tela" aria-label="VÃ­deo de abertura">
        <div class="libri-quadro">
          <video id="libriVideo" playsinline webkit-playsinline preload="metadata" disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video>
          <button id="libriPular" type="button" aria-label="Pular abertura">Pular abertura</button>
        </div>
      </section>

      <section id="libriCapaTela" class="libri-tela" aria-label="Capa do convite">
        <div class="libri-quadro">
          <img id="libriCapaImagem" class="libri-arte" alt="${escapeHtml(config.titulo || "Convite")}" draggable="false">
          <button id="libriAbrirConvite" type="button" aria-label="Abrir convite"></button>
        </div>
      </section>

      <div id="libriModalLocalizacao" class="libri-modal" role="dialog" aria-modal="true" aria-labelledby="libriTituloLocalizacao">
        <div class="libri-modal-card">
          <button id="libriFecharLocalizacao" class="libri-modal-fechar" type="button" aria-label="Fechar localizaÃ§Ã£o">&times;</button>
          <div class="libri-modal-conteudo">
            <div id="libriKickerLocalizacao" class="libri-modal-kicker"></div>
            <h2 id="libriTituloLocalizacao" class="libri-modal-titulo"></h2>
            <p id="libriEnderecoTexto" class="libri-endereco"></p>
            <div id="libriAcoesLocalizacao" class="libri-modal-acoes">
              <button id="libriAbrirGoogleMaps" class="libri-acao-principal" type="button"></button>
              <button id="libriAbrirWaze" class="libri-acao-rota" type="button"></button>
            </div>
          </div>
        </div>
      </div>

      <div id="libriModalPresentes" class="libri-modal" role="dialog" aria-modal="true" aria-label="SugestÃµes de presentes">
        <div class="libri-modal-card libri-presente-card">
          <button id="libriFecharPresentes" class="libri-modal-fechar" type="button" aria-label="Fechar presentes">&times;</button>
          <div class="libri-presente-wrap">
            <img id="libriPresentesImagem" class="libri-presente-img" alt="SugestÃµes de presentes" draggable="false">
          </div>
        </div>
      </div>

      <div id="libriModalRsvp" class="libri-rsvp-modal" role="dialog" aria-modal="true" aria-label="Confirmar presenÃ§a">
        <div class="libri-rsvp-shell">
          <button id="libriFecharRsvp" type="button" aria-label="Fechar confirmaÃ§Ã£o">&times;</button>
          <div id="libriRsvpLoading" class="libri-rsvp-loading">Carregando confirmaÃ§Ã£o...</div>
          <iframe id="libriRsvpFrame" title="ConfirmaÃ§Ã£o de presenÃ§a" loading="eager" referrerpolicy="strict-origin-when-cross-origin"></iframe>
          <a id="libriRsvpFallback" class="libri-rsvp-fallback" target="_blank" rel="noopener noreferrer" aria-hidden="true" tabindex="-1">Abrir confirmaÃ§Ã£o em nova pÃ¡gina</a>
        </div>
      </div>

      <audio id="libriMusica" preload="metadata" loop></audio>
    `;
  }

  function mediaUrl(config, arquivo) {
    const parts = String(arquivo || "")
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    return `${String(config.hostMidia).replace(/\/$/, "")}/${encodeURIComponent(config.pastaCliente)}/${parts}?v=${encodeURIComponent(config.versaoMidia)}`;
  }

  function assetUrl(config, caminho) {
    if (!caminho) return "";
    return `${caminho}?v=${encodeURIComponent(config.versaoArquivos)}`;
  }

  function setImage(img, config, path, required = false) {
    return new Promise((resolve) => {
      if (!img || !path) {
        resolve(false);
        return;
      }
      const onLoad = async () => {
        img.removeEventListener("error", onError);
        if (typeof img.decode === "function") await img.decode().catch(() => {});
        resolve(true);
      };
      const onError = () => {
        img.removeEventListener("load", onLoad);
        if (required) console.warn("[Libri] Imagem nÃ£o encontrada:", path);
        resolve(false);
      };
      img.addEventListener("load", onLoad, { once: true });
      img.addEventListener("error", onError, { once: true });
      img.src = assetUrl(config, path);
    });
  }

  function createHotspots(config) {
    const holder = $("libriHotspots");
    holder.innerHTML = "";

    const labels = {
      confirmacao: "Confirmar presenÃ§a",
      localizacao: "Ver localizaÃ§Ã£o",
      presentes: "Ver sugestÃµes de presentes",
      importante: "Ver informaÃ§Ã£o importante"
    };

    for (const [name, pos] of Object.entries(config.hotspotsFinal || {})) {
      if (!pos) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "libri-hotspot";
      button.dataset.acao = name;
      button.setAttribute("aria-label", labels[name] || name);
      button.style.left = pos.left;
      button.style.top = pos.top;
      button.style.width = pos.width;
      button.style.height = pos.height;
      holder.appendChild(button);
    }
  }

  function setupLocation(config) {
    const local = config.local || {};
    $("libriKickerLocalizacao").textContent = local.kicker || "LOCALIZAÃ‡ÃƒO";
    $("libriTituloLocalizacao").textContent = local.nome || "Local da festa";
    $("libriEnderecoTexto").innerHTML = [
      local.tipo,
      local.linha1,
      local.linha2,
      local.linha3,
      local.cep ? `CEP ${escapeHtml(local.cep)}` : ""
    ].filter(Boolean).map(escapeHtml).join("<br>");

    const maps = $("libriAbrirGoogleMaps");
    const waze = $("libriAbrirWaze");
    maps.textContent = config.botoes?.mapa || DEFAULTS.botoes.mapa;
    waze.textContent = config.botoes?.waze || DEFAULTS.botoes.waze;

    if (!config.linkLocalizacao && !config.linkGoogleMaps) maps.style.display = "none";
    if (!config.linkWaze) waze.style.display = "none";
  }

  function openExternal(url) {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function whatsappUrl(config) {
    const number = String(config.numeroWhatsapp || "").replace(/\D+/g, "");
    if (!number) return null;
    const msg = encodeURIComponent(config.mensagemWhatsapp || "OlÃ¡! Gostaria de confirmar minha presenÃ§a.");
    return `https://wa.me/${number}?text=${msg}`;
  }

  function rsvpEmbedUrl(config) {
    const url = new URL(config.linkConfirmacao);
    url.searchParams.set("embed", "1");
    return url.toString();
  }

  function openModal(modal, focusEl) {
    if (!modal) return;
    modal.classList.add("aberto");
    if (focusEl) focusEl.focus();
  }

  function closeModal(modal) {
    if (modal) modal.classList.remove("aberto");
  }

  function showRsvpLoaded() {
    const modal = $("libriModalRsvp");
    if (!modal?.classList.contains("aberto")) return;
    clearTimeout(state.timerRsvpFallback);
    state.timerRsvpFallback = null;
    $("libriRsvpLoading").classList.add("oculto");
    $("libriRsvpFrame").classList.add("pronto");
  }

  function openRsvp(config) {
    if (!config.linkConfirmacao) return;

    const video = activeVideo(config);
    state.videoRsvpEstavaTocando = Boolean(video && !video.paused);
    if (state.videoRsvpEstavaTocando) video.pause();

    clearTimeout(state.timerRsvpFallback);
    const frame = $("libriRsvpFrame");
    const loading = $("libriRsvpLoading");
    const fallback = $("libriRsvpFallback");

    loading.classList.remove("oculto");
    frame.classList.remove("pronto");
    fallback.href = config.linkConfirmacao;

    openModal($("libriModalRsvp"), $("libriFecharRsvp"));

    requestAnimationFrame(() => {
      try {
        frame.src = rsvpEmbedUrl(config);
      } catch (_) {
        frame.src = config.linkConfirmacao;
      }
    });

    state.timerRsvpFallback = setTimeout(showRsvpLoaded, 3500);
  }

  function closeRsvp(config) {
    closeModal($("libriModalRsvp"));
    clearTimeout(state.timerRsvpFallback);
    state.timerRsvpFallback = null;

    const video = activeVideo(config);
    if (video && state.videoRsvpEstavaTocando) {
      video.play().catch(() => {});
    }
    state.videoRsvpEstavaTocando = false;

    setTimeout(() => {
      const modal = $("libriModalRsvp");
      if (!modal.classList.contains("aberto")) {
        const frame = $("libriRsvpFrame");
        frame.src = "about:blank";
        frame.classList.remove("pronto");
        $("libriRsvpLoading").classList.remove("oculto");
      }
    }, 220);
  }

  function activeVideo(config) {
    return config.modo === "loop" ? $("libriVideoLoop") : $("libriVideo");
  }

  function setupActionHandlers(config) {
    $("libriHotspots").addEventListener("click", (event) => {
      const button = event.target.closest(".libri-hotspot");
      if (!button) return;
      const action = button.dataset.acao;

      if (action === "confirmacao") {
        if (config.confirmacaoModo === "whatsapp") {
          openExternal(whatsappUrl(config));
        } else if (config.confirmacaoModo === "link") {
          openExternal(config.linkConfirmacao);
        } else {
          openRsvp(config);
        }
        return;
      }

      if (action === "localizacao") {
        openModal($("libriModalLocalizacao"), $("libriFecharLocalizacao"));
        return;
      }

      if (action === "presentes") {
        if (config.imagens?.presentes) {
          openModal($("libriModalPresentes"), $("libriFecharPresentes"));
        }
        return;
      }

      const extra = config.acoesExtras?.[action];
      if (extra?.url) openExternal(extra.url);
    });

    $("libriAbrirGoogleMaps").addEventListener("click", () => {
      openExternal(config.linkLocalizacao || config.linkGoogleMaps);
    });
    $("libriAbrirWaze").addEventListener("click", () => openExternal(config.linkWaze));
    $("libriFecharLocalizacao").addEventListener("click", () => closeModal($("libriModalLocalizacao")));
    $("libriFecharPresentes").addEventListener("click", () => closeModal($("libriModalPresentes")));
    $("libriFecharRsvp").addEventListener("click", () => closeRsvp(config));

    $("libriModalLocalizacao").addEventListener("click", (event) => {
      if (event.target === $("libriModalLocalizacao")) closeModal($("libriModalLocalizacao"));
    });
    $("libriModalPresentes").addEventListener("click", (event) => {
      if (event.target === $("libriModalPresentes")) closeModal($("libriModalPresentes"));
    });
    $("libriModalRsvp").addEventListener("click", (event) => {
      if (event.target === $("libriModalRsvp")) closeRsvp(config);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if ($("libriModalRsvp").classList.contains("aberto")) return closeRsvp(config);
      if ($("libriModalPresentes").classList.contains("aberto")) return closeModal($("libriModalPresentes"));
      if ($("libriModalLocalizacao").classList.contains("aberto")) return closeModal($("libriModalLocalizacao"));
    });

    $("libriRsvpFrame").addEventListener("load", () => {
      const frame = $("libriRsvpFrame");
      if (!$("libriModalRsvp").classList.contains("aberto")) return;
      if (!frame.src || frame.src === "about:blank") return;
      showRsvpLoaded();
    });

    window.addEventListener("message", (event) => {
      const frame = $("libriRsvpFrame");
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== "libri-rsvp") return;
      if (data.type === "libri-rsvp-ready") return showRsvpLoaded();
      if (data.type === "libri-rsvp-close") return closeRsvp(config);
      if (data.type === "libri-rsvp-complete") {
        $("libriModalRsvp").dataset.status = data.status || "";
      }
    });
  }

  function setupMedia(config) {
    const video = $("libriVideo");
    const loopVideo = $("libriVideoLoop");
    const music = $("libriMusica");

    const videoSrc = mediaUrl(config, config.videoArquivo);
    video.src = videoSrc;
    loopVideo.src = videoSrc;
    loopVideo.loop = true;
    music.src = config.musicaArquivo ? mediaUrl(config, config.musicaArquivo) : "";

    video.preload = "metadata";
    loopVideo.preload = "metadata";
    music.preload = "metadata";

    video.load();
    loopVideo.load();
    if (config.musicaArquivo) music.load();

    if (config.modo === "loop") {
      $("libriVideoTela").style.display = "none";
      loopVideo.hidden = false;
      $("libriFinalTela").classList.add("ativo");
    } else {
      loopVideo.hidden = true;
    }
  }

  function warmMedia(config) {
    if (state.midiaAquecida) return;
    state.midiaAquecida = true;
    const video = activeVideo(config);
    const music = $("libriMusica");
    video.preload = "auto";
    video.load();
    if (config.musicaArquivo) {
      music.preload = "auto";
      music.load();
    }
  }

  function scheduleWarmup(config, capaPromise) {
    const run = () => {
      if ("requestIdleCallback" in window) {
        requestIdleCallback(() => warmMedia(config), { timeout: 1400 });
      } else {
        setTimeout(() => warmMedia(config), 550);
      }
    };
    capaPromise.catch(() => false).finally(run);
  }

  function hideCover() {
    const cover = $("libriCapaTela");
    if (cover.classList.contains("saindo")) return;
    cover.classList.add("saindo");
    setTimeout(() => { cover.style.visibility = "hidden"; }, 200);
  }

  function waitFirstFrame(video, timeoutMs = 2600) {
    return new Promise((resolve) => {
      let done = false;
      let timer = null;
      const finish = (ok = true) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      timer = setTimeout(() => finish(false), timeoutMs);
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(() => finish(true));
        return;
      }
      if (video.readyState >= 2) {
        requestAnimationFrame(() => finish(true));
        return;
      }
      video.addEventListener("loadeddata", () => finish(true), { once: true });
    });
  }

  function startMusicSilent(config) {
    const music = $("libriMusica");
    if (!config.musicaArquivo) {
      state.audioDisponivel = false;
      return;
    }
    music.volume = 0.001;
    try { music.currentTime = Math.max(0, Number(config.inicioMusica) || 0); } catch (_) {}
    const attempt = music.play();
    if (attempt?.catch) {
      attempt.catch(() => {
        state.audioDisponivel = false;
        $("libriControleSom").classList.remove("visivel");
      });
    }
  }

  function startMusicNormal(config) {
    const music = $("libriMusica");
    if (!config.musicaArquivo) {
      state.audioDisponivel = false;
      return;
    }
    music.volume = state.somLigado ? config.volumeMusica : 0;
    try { music.currentTime = Math.max(0, Number(config.inicioMusica) || 0); } catch (_) {}
    const attempt = music.play();
    if (attempt?.catch) {
      attempt.catch(() => {
        state.audioDisponivel = false;
        $("libriControleSom").classList.remove("visivel");
      });
    }
  }

  function expectedMusicTime(config) {
    const video = $("libriVideo");
    const music = $("libriMusica");
    let expected = Math.max(0, video.currentTime + (Number(config.inicioMusica) || 0));
    if (Number.isFinite(music.duration) && music.duration > 0) expected %= music.duration;
    return expected;
  }

  function keepSync(config, force = false) {
    if (config.modo !== "cinematico") return;
    const video = $("libriVideo");
    const music = $("libriMusica");
    if (!state.audioDisponivel || state.finalAtivo || video.paused || music.paused) return;

    const now = performance.now();
    if (!force && now - state.ultimoAjusteSincronia < 1000) return;
    state.ultimoAjusteSincronia = now;

    const expected = expectedMusicTime(config);
    const diff = Math.abs(music.currentTime - expected);
    if (force || diff > 0.35) {
      try { music.currentTime = expected; } catch (_) {}
    }
  }

  function audioCrossfade(config, done) {
    const video = $("libriVideo");
    const music = $("libriMusica");
    cancelAnimationFrame(state.rafAudio);

    if (!state.audioDisponivel || music.paused) {
      done();
      return;
    }

    const duration = Math.max(120, Number(config.transicaoAudio) || 260);
    const start = performance.now();
    const videoStart = video.volume;
    const musicStart = music.volume;
    const musicEnd = state.somLigado ? config.volumeMusica : 0;

    const animate = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const smooth = progress * progress * (3 - 2 * progress);
      video.volume = Math.max(0, videoStart * (1 - smooth));
      music.volume = musicStart + (musicEnd - musicStart) * smooth;
      if (progress < 1) {
        state.rafAudio = requestAnimationFrame(animate);
        return;
      }
      video.volume = 0;
      music.volume = musicEnd;
      done();
    };
    state.rafAudio = requestAnimationFrame(animate);
  }

  function watchEnd(config) {
    cancelAnimationFrame(state.rafFim);
    const video = $("libriVideo");
    const tick = () => {
      if (state.finalizando || state.finalAtivo) return;
      keepSync(config);
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const remaining = video.duration - video.currentTime;
        if (remaining > 0 && remaining <= 0.45) {
          finishVideo(config);
          return;
        }
      }
      state.rafFim = requestAnimationFrame(tick);
    };
    state.rafFim = requestAnimationFrame(tick);
  }

  async function finishVideo(config) {
    if (state.finalizando || state.finalAtivo || config.modo !== "cinematico") return;
    const video = $("libriVideo");
    keepSync(config, true);
    state.finalizando = true;
    clearTimeout(state.timerPular);
    cancelAnimationFrame(state.rafFim);
    $("libriPular").classList.remove("visivel");

    $("libriFinalTela").classList.add("ativo");
    $("libriVideoTela").classList.add("saindo");

    audioCrossfade(config, () => {
      video.pause();
      $("libriVideoTela").classList.remove("ativo", "saindo");
      $("libriVideoTela").style.visibility = "hidden";
      video.volume = 1;
      state.finalAtivo = true;
      state.finalizando = false;
      if (state.audioDisponivel) $("libriControleSom").classList.add("visivel");
    });
  }

  async function startCinematic(config, capaPromise, finalPromise) {
    if (state.conviteAberto) return;
    state.conviteAberto = true;
    warmMedia(config);

    await capaPromise.catch(() => false);
    finalPromise.catch(() => false);

    const video = $("libriVideo");
    const videoScreen = $("libriVideoTela");
    videoScreen.style.visibility = "visible";
    videoScreen.classList.remove("saindo");
    videoScreen.classList.add("ativo");

    startMusicSilent(config);
    video.volume = 1;
    try { video.currentTime = 0; } catch (_) {}

    const firstFrame = waitFirstFrame(video);
    try {
      await video.play();
      const ready = await firstFrame;
      if (!ready) throw new Error("Primeiro frame indisponÃ­vel");
    } catch (_) {
      hideCover();
      finishVideo(config);
      return;
    }

    hideCover();
    $("libriPular").classList.add("visivel");
    clearTimeout(state.timerPular);
    state.timerPular = setTimeout(() => $("libriPular").classList.remove("visivel"), Number(config.tempoPular) || 5000);
    watchEnd(config);
  }

  async function startLoop(config, capaPromise, finalPromise) {
    if (state.conviteAberto) return;
    state.conviteAberto = true;
    warmMedia(config);
    await Promise.allSettled([capaPromise, finalPromise]);

    const video = $("libriVideoLoop");
    const firstFrame = waitFirstFrame(video, 2200);
    startMusicNormal(config);
    try { video.currentTime = 0; } catch (_) {}

    try {
      await video.play();
      await firstFrame;
    } catch (_) {
      video.hidden = true;
    }

    hideCover();
    state.finalAtivo = true;
    $("libriFinalTela").classList.add("ativo");
    if (state.audioDisponivel) $("libriControleSom").classList.add("visivel");
  }

  function toggleSound(config) {
    if (!state.audioDisponivel) return;
    state.somLigado = !state.somLigado;
    $("libriMusica").volume = state.somLigado ? config.volumeMusica : 0;
    $("libriControleSom").classList.toggle("mudo", !state.somLigado);
  }

  function visibilityHandler(config) {
    const video = activeVideo(config);
    const music = $("libriMusica");

    if (document.hidden) {
      state.videoEstavaTocando = !video.paused && (config.modo === "loop" || (!state.finalAtivo && !state.finalizando));
      state.musicaEstavaTocando = !music.paused;
      if (state.videoEstavaTocando) video.pause();
      if (state.musicaEstavaTocando) music.pause();
      return;
    }

    if (state.videoEstavaTocando && (config.modo === "loop" || !state.finalAtivo)) {
      video.play().then(() => {
        if (config.modo === "cinematico") watchEnd(config);
      }).catch(() => {});
    }
    if (state.musicaEstavaTocando && state.audioDisponivel) {
      music.play().catch(() => {});
    }

    state.videoEstavaTocando = false;
    state.musicaEstavaTocando = false;
  }

  async function init() {
    try {
      const config = await loadConfig();
      state.config = config;
      const errors = validateConfig(config);
      if (errors.length) throw new Error(errors.join("; "));

      applyTheme(config);
      renderBase(config);
      createHotspots(config);
      setupLocation(config);
      setupMedia(config);
      setupActionHandlers(config);

      const coverPromise = setImage($("libriCapaImagem"), config, config.imagens.capa, true);
      const finalPromise = setImage($("libriFinalImagem"), config, config.imagens.final, true);
      if (config.imagens?.presentes) {
        setImage($("libriPresentesImagem"), config, config.imagens.presentes, false);
      }

      scheduleWarmup(config, coverPromise);

      $("libriAbrirConvite").addEventListener("click", () => {
        if (config.modo === "loop") {
          startLoop(config, coverPromise, finalPromise);
        } else {
          startCinematic(config, coverPromise, finalPromise);
        }
      });

      $("libriPular").addEventListener("click", () => finishVideo(config));
      $("libriControleSom").addEventListener("click", () => toggleSound(config));

      $("libriVideo").addEventListener("timeupdate", () => {
        if (state.finalizando || state.finalAtivo || config.modo !== "cinematico") return;
        keepSync(config);
        const video = $("libriVideo");
        if (Number.isFinite(video.duration) && video.duration > 0 && (video.duration - video.currentTime) <= 0.45) {
          finishVideo(config);
        }
      });
      $("libriVideo").addEventListener("ended", () => finishVideo(config));
      $("libriVideo").addEventListener("error", () => {
        if (state.conviteAberto && config.modo === "cinematico" && !state.finalAtivo) {
          hideCover();
          finishVideo(config);
        }
      });
      $("libriVideoLoop").addEventListener("error", () => {
        $("libriVideoLoop").hidden = true;
      });
      $("libriMusica").addEventListener("error", () => {
        state.audioDisponivel = false;
        $("libriControleSom").classList.remove("visivel");
      });

      document.addEventListener("visibilitychange", () => visibilityHandler(config));
      window.addEventListener("pageshow", (event) => {
        if (event.persisted && state.finalAtivo && state.audioDisponivel) {
          const music = $("libriMusica");
          music.volume = state.somLigado ? config.volumeMusica : 0;
          music.play().catch(() => {});
        }
      });

      document.addEventListener("contextmenu", (event) => event.preventDefault());
      document.addEventListener("dragstart", (event) => event.preventDefault());
    } catch (error) {
      fail(error?.message || "Erro ao carregar o convite.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();