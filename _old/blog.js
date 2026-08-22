const ARTICLE_INDEX_PATH = "content/articles.json";

function formatDate(isoDate) {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatShortDate(isoDate) {
  const d = new Date(isoDate);
  const yy = String(d.getFullYear()).slice(-2);
  return `${d.getMonth() + 1}.${d.getDate()}.${yy}`;
}

function applyInlineMarkdown(text) {
  return text
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+\.mp4(?:\?[^)\s]*)?)\)/gi,
      '<video controls preload="metadata" playsinline src="$2" aria-label="$1"></video>'
    )
    .replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      '<img src="$2" alt="$1" loading="lazy" />'
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function markdownToHtml(markdown) {
  const lines = markdown.split("\n");
  const html = [];
  let inList = false;
  let inOrderedList = false;
  let inCodeBlock = false;
  let currentCodeLang = "text";
  let paragraph = [];

  const closeParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${applyInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  const closeLists = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
    if (inOrderedList) {
      html.push("</ol>");
      inOrderedList = false;
    }
  };

  const isTableDelimiter = (line) =>
    /^\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?$/.test(line.trim());

  const splitTableRow = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    if (line.startsWith("```")) {
      closeParagraph();
      closeLists();
      if (inCodeBlock) {
        html.push("</code></pre>");
        currentCodeLang = "text";
      } else {
        const declared = line.slice(3).trim().toLowerCase();
        const safeLang = declared.replace(/[^a-z0-9_+-]/g, "") || "text";
        currentCodeLang = safeLang;
        html.push(`<pre><code data-lang="${safeLang}">`);
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      html.push(
        line
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
      );
      continue;
    }

    if (!line) {
      closeParagraph();
      closeLists();
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      closeParagraph();
      closeLists();

      const headers = splitTableRow(line);
      const rows = [];
      i += 2;

      while (i < lines.length) {
        const rowLine = lines[i].trimEnd();
        if (!rowLine || !rowLine.includes("|")) break;
        rows.push(splitTableRow(rowLine));
        i += 1;
      }

      i -= 1;

      const headHtml = headers.map((h) => `<th>${applyInlineMarkdown(h)}</th>`).join("");
      const bodyHtml = rows
        .map(
          (r) =>
            `<tr>${r.map((c) => `<td>${applyInlineMarkdown(c)}</td>`).join("")}</tr>`
        )
        .join("");

      html.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
      continue;
    }

    if (line.startsWith("# ")) {
      closeParagraph();
      closeLists();
      html.push(`<h1>${applyInlineMarkdown(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith("## ")) {
      closeParagraph();
      closeLists();
      html.push(`<h2>${applyInlineMarkdown(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith("### ")) {
      closeParagraph();
      closeLists();
      html.push(`<h3>${applyInlineMarkdown(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith("> ")) {
      closeParagraph();
      closeLists();
      html.push(`<blockquote>${applyInlineMarkdown(line.slice(2))}</blockquote>`);
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)/);
    if (unorderedMatch) {
      closeParagraph();
      if (!inList) {
        closeLists();
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${applyInlineMarkdown(unorderedMatch[1])}</li>`);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)/);
    if (orderedMatch) {
      closeParagraph();
      if (!inOrderedList) {
        closeLists();
        html.push("<ol>");
        inOrderedList = true;
      }
      html.push(`<li>${applyInlineMarkdown(orderedMatch[1])}</li>`);
      continue;
    }

    closeLists();
    paragraph.push(line);
  }

  closeParagraph();
  closeLists();

  return html.join("\n");
}

function enhanceCodeBlocks(root) {
  const codeNodes = root.querySelectorAll("pre > code");

  codeNodes.forEach((codeEl) => {
    const preEl = codeEl.parentElement;
    if (!preEl || preEl.parentElement?.classList.contains("code-block")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "code-block";
    preEl.parentNode.insertBefore(wrapper, preEl);
    wrapper.appendChild(preEl);

    const language = (codeEl.dataset.lang || "text").toUpperCase();
    const langEl = document.createElement("span");
    langEl.className = "code-lang";
    langEl.textContent = language;
    wrapper.appendChild(langEl);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = "Copy";

    button.addEventListener("click", async () => {
      const source = codeEl.textContent || "";

      try {
        await navigator.clipboard.writeText(source);
        button.textContent = "Copied";
        setTimeout(() => {
          button.textContent = "Copy";
        }, 1400);
      } catch (error) {
        button.textContent = "Failed";
        setTimeout(() => {
          button.textContent = "Copy";
        }, 1400);
      }
    });

    wrapper.appendChild(button);
  });
}

async function loadArticleIndex() {
  const response = await fetch(ARTICLE_INDEX_PATH);
  if (!response.ok) throw new Error("Failed to load article index.");
  return response.json();
}

function initHelloModal() {
  const openButton = document.querySelector("[data-open-hello-modal]");
  const modalBackdrop = document.querySelector("[data-hello-modal-backdrop]");

  if (!openButton || !modalBackdrop) return;

  const closeButton = modalBackdrop.querySelector("[data-close-hello-modal]");
  const submitCommentButton = modalBackdrop.querySelector("[data-submit-comment]");
  const commentInput = modalBackdrop.querySelector("#hello-comment");
  const honeypotInput = modalBackdrop.querySelector("#hello-website");
  const statusEl = modalBackdrop.querySelector("[data-hello-status]");
  let openedAt = Date.now();

  const setStatus = (message) => {
    if (statusEl) statusEl.textContent = message;
  };

  const openModal = () => {
    modalBackdrop.hidden = false;
    openedAt = Date.now();
    setStatus("");
  };

  const closeModal = () => {
    modalBackdrop.hidden = true;
  };

  openButton.addEventListener("click", openModal);
  closeButton?.addEventListener("click", closeModal);

  modalBackdrop.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) closeModal();
  });

  modalBackdrop.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-close-hello-modal]")) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modalBackdrop.hidden) closeModal();
  });

  submitCommentButton?.addEventListener("click", async () => {
    if (!commentInput) return;
    const comment = commentInput.value.trim();
    if (!comment) {
      setStatus("Please write a comment first.");
      return;
    }

    setStatus("Sending comment...");
    submitCommentButton.disabled = true;

    try {
      const response = await fetch("/api/hello/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comment,
          website: honeypotInput?.value || "",
          elapsedMs: Date.now() - openedAt,
        }),
      });

      if (!response.ok) {
        if (response.status === 501) {
          throw new Error(
            "Comment API is unavailable on static localhost. Run with `wrangler dev` or use the deployed URL."
          );
        }

        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to save comment.");
      }
      commentInput.value = "";
      if (honeypotInput) honeypotInput.value = "";
      setStatus("Comment received. Thank you!");
      setTimeout(closeModal, 550);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send comment right now.";
      setStatus(message);
      console.error(error);
    } finally {
      submitCommentButton.disabled = false;
    }
  });
}

const PROJECTS = [
  {
    type: "project",
    name: "agent-experience.dev",
    url: "https://agent-experience.dev",
    img: "https://image.thum.io/get/width/1200/noanimate/https://agent-experience.dev",
    date: "2026-03-01",
  },
  {
    type: "project",
    name: "mahoraga",
    url: "https://mahoraga.dev",
    img: "https://mahoraga.dev/dashboard.png",
    imgFallback: "https://image.thum.io/get/width/1200/noanimate/https://mahoraga.dev",
    date: "2026-02-04",
  },
  {
    type: "project",
    name: "okiro",
    url: "https://okiro.run",
    img: "https://image.thum.io/get/width/1200/noanimate/https://okiro.run",
    date: "2026-01-16",
    wide: true,
  },
  {
    type: "project",
    name: "merchant",
    url: "https://merchant.dev",
    img: "https://image.thum.io/get/width/1200/noanimate/https://merchant.dev",
    date: "2025-12-01",
    wide: true,
    tall: true,
  },
  {
    type: "project",
    name: "Outerbase",
    url: "https://outerbase.com",
    img: "https://outerbase.com/_next/static/media/dashboards-2-sm.3a2c3fd6.webp",
    imgFallback: "https://image.thum.io/get/width/1200/noanimate/https://outerbase.com",
    date: "2024-01-01",
  },
];

function renderProjectCard(project) {
  const fallback = project.imgFallback
    ? ` onerror="this.src='${project.imgFallback}';"`
    : "";
  const wide = project.wide ? " card--wide" : "";
  const tall = project.tall ? " card--tall" : "";
  return `<a class="card card--project${wide}${tall}" href="${project.url}" target="_blank" rel="noreferrer">
    <img src="${project.img}" alt="${project.name}" loading="lazy"${fallback} />
    <span class="project-name">${project.name}</span>
  </a>`;
}

function renderArticleCard(post) {
  return `<a class="card card--article" href="article.html?slug=${encodeURIComponent(post.slug)}" data-article-slug="${post.slug}">
    <div class="card--article-title">${post.title}</div>
    <div class="card--article-body">
      <p>${post.summary}</p>
    </div>
    <span class="card--article-meta">${post.readTime}</span>
  </a>`;
}

async function fillArticleCards(posts) {
  const cards = document.querySelectorAll("[data-article-slug]");
  if (!cards.length) return;

  const fetches = posts.map(async (post) => {
    try {
      const res = await fetch(post.path);
      if (!res.ok) return;
      const raw = await res.text();
      const stripped = raw.replace(/^#\s.+\n?/, "");
      const firstPara = stripped.split(/\n\n/).find((b) => b.trim() && !b.trim().startsWith("#")) || stripped.split(/\n\n/)[0];
      const card = document.querySelector(`[data-article-slug="${post.slug}"] .card--article-body`);
      if (card) card.innerHTML = `<p>${applyInlineMarkdown(firstPara.trim())}</p>`;
    } catch {}
  });

  await Promise.all(fetches);
}

function renderFeed(posts) {
  const bento = document.querySelector(".bento");
  if (!bento) return;

  const articles = posts.map((p) => ({ ...p, type: "article" }));
  const all = [...articles, ...PROJECTS].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  const html = all
    .map((item) => {
      if (item.type === "project") return renderProjectCard(item);
      return renderArticleCard(item);
    })
    .join("");

  bento.insertAdjacentHTML("beforeend", html);
  fillArticleCards(posts);
}

async function renderArticle() {
  const contentEl = document.querySelector("[data-article-content]");
  const titleEl = document.querySelector("[data-article-title]");
  const metaEl = document.querySelector("[data-article-meta]");

  if (!contentEl || !titleEl || !metaEl) return;

  try {
    const posts = await loadArticleIndex();
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("slug") || posts[0]?.slug;
    const post = posts.find((item) => item.slug === slug) || posts[0];

    if (!post) {
      contentEl.innerHTML = "<p>Article not found.</p>";
      return;
    }

    titleEl.textContent = post.title;
    metaEl.textContent = `${formatDate(post.date)} - ${post.readTime}`;
    document.title = `${post.title} - burcs.dev`;

    const markdownResponse = await fetch(post.path);
    if (!markdownResponse.ok) throw new Error("Failed to load markdown file.");
    const rawMarkdown = await markdownResponse.text();
    const markdown = rawMarkdown.replace(/^#\s.+\n?/, "");

    contentEl.innerHTML = markdownToHtml(markdown);
    enhanceCodeBlocks(contentEl);
  } catch (error) {
    contentEl.innerHTML =
      "<p>Could not load article content. Run a local server (for example: python3 -m http.server).</p>";
    console.error(error);
  }
}

async function init() {
  initHelloModal();

  const bentoEl = document.querySelector(".bento");
  if (bentoEl) {
    try {
      const posts = await loadArticleIndex();
      renderFeed(posts);
    } catch (error) {
      console.error(error);
    }
  }

  renderArticle();
}

init();