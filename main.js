"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  CreateMomentModal: () => CreateMomentModal,
  DEFAULT_SETTINGS: () => DEFAULT_SETTINGS,
  MomentsSettingTab: () => MomentsSettingTab,
  default: () => ObsidianMomentsPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
function parseMarkdownLink(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^\[([^\]]+)\]\((.+)\)$/);
  if (!match) return null;
  const [, rawLabel, rawUrl] = match;
  const label = rawLabel.trim();
  const url = rawUrl.trim();
  if (!label || !url) return null;
  try {
    new URL(url);
    return { label, url };
  } catch (e) {
    return null;
  }
}
function serializeFrontmatterString(value) {
  return JSON.stringify(value);
}
var DEFAULT_SETTINGS = {
  momentsPath: "Moments/\u8BB0\u5F55/",
  attachmentsPath: "Moments/Attachments/",
  order: "desc"
};
var ObsidianMomentsPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MomentsSettingTab(this.app, this));
    this.addCommand({
      id: "create-moments",
      name: "\u521B\u5EFA Moments",
      callback: () => {
        new CreateMomentModal(this.app, this).open();
      }
    });
    this.registerMarkdownCodeBlockProcessor("moments", async (_source, el, ctx) => {
      await this.renderMomentsFeed(el, ctx.sourcePath);
    });
  }
  onunload() {
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async renderMomentsFeed(containerEl, currentSourcePath) {
    containerEl.empty();
    const feedEl = containerEl.createDiv({ cls: "moments-feed" });
    const folderPath = this.cleanFolderPath(this.settings.momentsPath);
    if (!folderPath) {
      feedEl.createDiv({ text: "\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u914D\u7F6E Moments \u5B58\u50A8\u8DEF\u5F84\u3002" });
      return;
    }
    const files = this.getMomentMarkdownFiles(folderPath, currentSourcePath);
    if (files.length === 0) {
      feedEl.createDiv({ text: "\u6682\u65E0 Moments \u8BB0\u5F55\u3002" });
      return;
    }
    const items = [];
    for (const file of files) {
      const item = await this.readMomentItem(file);
      if (item) items.push(item);
    }
    items.sort((a, b) => {
      const timeA = this.parseDateTime(a.createdAt);
      const timeB = this.parseDateTime(b.createdAt);
      return this.settings.order === "asc" ? timeA - timeB : timeB - timeA;
    });
    for (const item of items) {
      this.renderMomentCard(feedEl, item);
    }
  }
  getMomentMarkdownFiles(folderPath, currentSourcePath) {
    const prefix = `${folderPath}/`;
    return this.app.vault.getFiles().filter((file) => {
      if (file.extension !== "md") return false;
      if (!file.path.startsWith(prefix)) return false;
      if (currentSourcePath && file.path === currentSourcePath) return false;
      return file.name.startsWith("Moments-");
    });
  }
  async readMomentItem(file) {
    var _a;
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (_a = cache == null ? void 0 : cache.frontmatter) != null ? _a : {};
    if (!file.name.startsWith("Moments-")) {
      return null;
    }
    const title = typeof frontmatter["\u6807\u9898"] === "string" ? frontmatter["\u6807\u9898"] : file.basename;
    const location = typeof frontmatter["\u5730\u70B9"] === "string" ? frontmatter["\u5730\u70B9"] : "";
    const createdAt = typeof frontmatter["\u521B\u5EFA\u65F6\u95F4"] === "string" ? frontmatter["\u521B\u5EFA\u65F6\u95F4"] : "";
    const raw = await this.app.vault.read(file);
    const markdownBody = this.stripYamlFrontmatter(raw).trim();
    const body = this.extractContentSection(markdownBody);
    const images = this.extractImageLinks(markdownBody);
    const comments = this.extractCommentsFromMarkdown(markdownBody);
    return { file, title, location, createdAt, comments, body, images };
  }
  stripYamlFrontmatter(content) {
    return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  }
  extractImageLinks(content) {
    const imageSection = this.extractTopLevelSection(content, "\u56FE\u7247");
    const scope = imageSection != null ? imageSection : content;
    const result = [];
    this.forEachNonCodeSegment(scope, (segment) => {
      const regex = /!\[\[([^\]]+?)\]\]/g;
      let match = null;
      while ((match = regex.exec(segment)) !== null) {
        const raw = match[1].split("|")[0].trim();
        if (raw) result.push(raw);
      }
    });
    return result;
  }
  extractContentSection(content) {
    const normalized = content.replace(/\r\n/g, "\n");
    const section = this.extractTopLevelSection(normalized, "\u6B63\u6587");
    if (section !== null) {
      return section.trim();
    }
    return this.removeImageLinksFromBody(normalized).trim();
  }
  extractTopLevelSection(content, headingName) {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const collected = [];
    let inFence = false;
    let collecting = false;
    let fenceToken = "";
    for (const line of lines) {
      const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
      if (fenceMatch) {
        const token = fenceMatch[2].charAt(0);
        if (!inFence) {
          inFence = true;
          fenceToken = token;
        } else if (token === fenceToken) {
          inFence = false;
          fenceToken = "";
        }
      }
      if (!inFence) {
        const headingMatch = line.match(/^##\s*(.+?)\s*$/);
        if (headingMatch) {
          const currentHeading = headingMatch[1].trim();
          if (collecting) break;
          collecting = currentHeading === headingName;
          continue;
        }
      }
      if (collecting) {
        collected.push(line);
      }
    }
    if (!collecting && collected.length === 0) {
      return null;
    }
    return collected.join("\n");
  }
  forEachNonCodeSegment(content, handler) {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    let inFence = false;
    let fenceToken = "";
    let chunk = [];
    const flush = () => {
      if (chunk.length === 0) return;
      handler(chunk.join("\n"));
      chunk = [];
    };
    for (const line of lines) {
      const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
      if (fenceMatch) {
        flush();
        const token = fenceMatch[2].charAt(0);
        if (!inFence) {
          inFence = true;
          fenceToken = token;
        } else if (token === fenceToken) {
          inFence = false;
          fenceToken = "";
        }
        continue;
      }
      if (!inFence) {
        chunk.push(line);
      }
    }
    flush();
  }
  renderMomentCard(parentEl, item) {
    const cardEl = parentEl.createDiv({ cls: "moments-card" });
    const headerEl = cardEl.createDiv({ cls: "moments-card-header" });
    headerEl.createDiv({ cls: "moments-title", text: item.title || "\u672A\u547D\u540D" });
    const bodyEl = cardEl.createDiv({ cls: "moments-body" });
    bodyEl.setText(this.removeImageLinksFromBody(item.body));
    if (item.images.length > 0) {
      const imgCount = item.images.length;
      const gridEl = cardEl.createDiv({ cls: "moments-grid" });
      gridEl.addClass(`grid-${imgCount}`);
      if (imgCount === 1) gridEl.addClass("moments-grid--1");
      else if (imgCount <= 4) gridEl.addClass("moments-grid--2");
      else gridEl.addClass("moments-grid--3");
      this.applyGridLayoutStyle(gridEl, imgCount);
      for (const imageLink of item.images) {
        const imgSrc = this.resolveImageResourcePath(imageLink, item.file);
        if (!imgSrc) continue;
        const imgEl = gridEl.createEl("img", { cls: "moments-image" });
        imgEl.src = imgSrc;
        imgEl.alt = imageLink;
        imgEl.style.width = "100%";
        imgEl.style.display = "block";
        imgEl.style.objectFit = imgCount === 1 ? "contain" : "cover";
        imgEl.style.aspectRatio = imgCount === 1 ? "auto" : "1 / 1";
        imgEl.style.borderRadius = "4px";
      }
    }
    const commentsSectionEl = cardEl.createDiv({ cls: "moments-comments-section" });
    const commentsDetailsEl = commentsSectionEl.createEl("details", { cls: "moments-comments-details" });
    const commentsSummaryEl = commentsDetailsEl.createEl("summary", { cls: "moments-comments-summary" });
    commentsSummaryEl.setText(this.formatCommentsSummaryText(item.comments.length));
    const commentsBubbleEl = commentsDetailsEl.createDiv({ cls: "moments-comments-bubble" });
    const commentsInlineListEl = commentsBubbleEl.createDiv({ cls: "moments-comments-inline-list" });
    this.renderCommentsList(commentsInlineListEl, item.comments);
    const composerEl = commentsBubbleEl.createDiv({ cls: "moments-comment-composer is-hidden" });
    const commentInput = composerEl.createEl("input", {
      type: "text",
      cls: "moments-comment-input",
      placeholder: "\u5199\u8BC4\u8BBA..."
    });
    const submitCommentBtn = composerEl.createEl("button", { text: "\u53D1\u9001", cls: "moments-comment-submit" });
    if (item.comments.length === 0) {
      commentsSectionEl.addClass("is-hidden");
    }
    const metaRowEl = cardEl.createDiv({ cls: "moments-meta-row" });
    const metaLeftEl = metaRowEl.createDiv({ cls: "moments-meta-left" });
    metaLeftEl.createDiv({ cls: "moments-time", text: item.createdAt || "\u672A\u77E5\u65F6\u95F4" });
    const locationEl = metaLeftEl.createDiv({ cls: "moments-location" });
    locationEl.createSpan({ cls: "moments-location-icon", text: "\u{1F4CD}" });
    this.renderLocationValue(locationEl, item.location);
    const actionsEl = metaRowEl.createDiv({ cls: "moments-actions" });
    const detailBtn = actionsEl.createEl("button", { text: "\u8BE6\u60C5" });
    const commentBtn = actionsEl.createEl("button", { text: "\u8BC4\u8BBA" });
    detailBtn.addEventListener("click", async () => {
      await this.app.workspace.getLeaf(false).openFile(item.file);
    });
    commentBtn.addEventListener("click", () => {
      commentsSectionEl.removeClass("is-hidden");
      commentsDetailsEl.open = true;
      composerEl.removeClass("is-hidden");
      commentInput.focus();
    });
    submitCommentBtn.addEventListener("click", async () => {
      const commentText = commentInput.value.trim();
      if (!commentText) {
        new import_obsidian.Notice("\u8BC4\u8BBA\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
        return;
      }
      const now = /* @__PURE__ */ new Date();
      const commentLine = `${this.formatCommentTime(now)} - ${commentText}`;
      try {
        await this.app.vault.process(item.file, (data) => {
          const normalized = data.replace(/\r\n/g, "\n").trimEnd();
          const commentItem = `- ${commentLine}`;
          if (!/^\s*##\s*评论区\s*$/m.test(normalized)) {
            return `${normalized}

## \u8BC4\u8BBA\u533A
${commentItem}
`;
          }
          const commentSectionRegex = /(^##\s*评论区\s*$)([\s\S]*?)$/m;
          return normalized.replace(commentSectionRegex, (_m, heading, body) => {
            const sectionBody = body.trimEnd();
            if (!sectionBody) {
              return `${heading}
${commentItem}`;
            }
            return `${heading}
${sectionBody}
${commentItem}`;
          }) + "\n";
        });
        item.comments.push(commentLine);
        this.renderCommentsList(commentsInlineListEl, item.comments);
        commentsSummaryEl.setText(this.formatCommentsSummaryText(item.comments.length));
        commentsSectionEl.removeClass("is-hidden");
        commentsDetailsEl.open = true;
        commentInput.value = "";
        new import_obsidian.Notice("\u8BC4\u8BBA\u5DF2\u6DFB\u52A0");
      } catch (error) {
        console.error(error);
        new import_obsidian.Notice("\u8BC4\u8BBA\u63D0\u4EA4\u5931\u8D25");
      }
    });
  }
  renderCommentsList(containerEl, comments) {
    containerEl.empty();
    if (comments.length === 0) {
      containerEl.createDiv({ cls: "moments-comment-empty", text: "\u6682\u65E0\u8BC4\u8BBA" });
      return;
    }
    for (const comment of comments) {
      containerEl.createDiv({ cls: "moments-comment-item", text: comment });
    }
  }
  extractCommentsFromMarkdown(content) {
    const commentsSection = this.extractTopLevelSection(content, "\u8BC4\u8BBA\u533A");
    if (!commentsSection) return [];
    const comments = [];
    this.forEachNonCodeSegment(commentsSection, (segment) => {
      for (const line of segment.split("\n")) {
        const match = line.match(/^\s*-\s+(.+?)\s*$/);
        if (match) comments.push(match[1]);
      }
    });
    return comments;
  }
  formatCommentsSummaryText(count) {
    return `\u{1F4AC} ${count} \u6761\u8BC4\u8BBA`;
  }
  removeImageLinksFromBody(content) {
    const parts = [];
    this.forEachNonCodeSegment(content, (segment) => {
      parts.push(segment.replace(/!\[\[[^\]]+?\]\]/g, ""));
    });
    return parts.join("\n").trim();
  }
  resolveImageResourcePath(link, fromFile) {
    const target = this.app.metadataCache.getFirstLinkpathDest(link, fromFile.path);
    if (!target) return null;
    return this.app.vault.adapter.getResourcePath(target.path);
  }
  applyGridLayoutStyle(gridEl, imgCount) {
    gridEl.style.display = "grid";
    gridEl.style.gap = "5px";
    if (imgCount === 1) {
      gridEl.style.gridTemplateColumns = "1fr";
      gridEl.style.maxWidth = "220px";
    } else if (imgCount <= 4) {
      gridEl.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
      gridEl.style.maxWidth = "220px";
    } else {
      gridEl.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
      gridEl.style.maxWidth = "330px";
    }
  }
  parseDateTime(value) {
    if (!value) return 0;
    const parsed = Date.parse(value.replace(" ", "T"));
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  renderLocationValue(locationEl, location) {
    const trimmedLocation = location.trim();
    if (!trimmedLocation) {
      locationEl.appendText("\u672A\u586B\u5199\u5730\u70B9");
      return;
    }
    const markdownLink = parseMarkdownLink(trimmedLocation);
    if (!markdownLink) {
      locationEl.appendText(trimmedLocation);
      return;
    }
    const locationLinkEl = locationEl.createEl("a", {
      cls: "moments-location-link",
      text: markdownLink.label,
      href: markdownLink.url
    });
    locationLinkEl.target = "_blank";
    locationLinkEl.rel = "noopener noreferrer";
    locationLinkEl.addEventListener("click", (event) => {
      event.preventDefault();
      window.open(markdownLink.url, "_blank", "noopener,noreferrer");
    });
  }
  formatCommentTime(date) {
    const yyyy = date.getFullYear();
    const mm = this.pad(date.getMonth() + 1);
    const dd = this.pad(date.getDate());
    const hh = this.pad(date.getHours());
    const mi = this.pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }
  formatDateTime(date) {
    const yyyy = date.getFullYear();
    const mm = this.pad(date.getMonth() + 1);
    const dd = this.pad(date.getDate());
    const hh = this.pad(date.getHours());
    const mi = this.pad(date.getMinutes());
    const ss = this.pad(date.getSeconds());
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }
  pad(value) {
    return value.toString().padStart(2, "0");
  }
  cleanFolderPath(path) {
    const trimmed = path.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    return trimmed ? (0, import_obsidian.normalizePath)(trimmed) : "";
  }
};
var CreateMomentModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.titleValue = "";
    this.locationValue = "";
    this.contentValue = "";
    this.selectedFiles = [];
    this.plugin = plugin;
  }
  onOpen() {
    this.modalEl.addClass("moments-create-modal");
    const { contentEl } = this;
    contentEl.empty();
    const modalContent = contentEl.closest(".modal-content");
    if (modalContent) {
      modalContent.style.maxHeight = "75vh";
      modalContent.style.overflowY = "auto";
    }
    contentEl.createEl("h2", { text: "\u521B\u5EFA Moments" });
    new import_obsidian.Setting(contentEl).setName("\u6807\u9898").addText(
      (text) => text.setPlaceholder("\u8F93\u5165\u6807\u9898").onChange((value) => {
        this.titleValue = value.trim();
      })
    );
    const locationSetting = new import_obsidian.Setting(contentEl).setName("\u5730\u70B9");
    locationSetting.controlEl.addClass("moments-location-control");
    locationSetting.addText((text) => {
      text.inputEl.addClass("moments-location-input");
      text.setPlaceholder("\u8F93\u5165\u5730\u70B9").onChange((value) => {
        this.locationValue = value.trim();
      });
    });
    if (import_obsidian.Platform.isIosApp) {
      locationSetting.addButton((button) => {
        button.setButtonText("\u5730\u56FE\u9009\u5740").onClick(() => {
          this.openMapPicker();
        });
        button.buttonEl.addClass("moments-map-picker-button");
      });
    }
    const contentSetting = new import_obsidian.Setting(contentEl).setName("\u5185\u5BB9");
    const textarea = contentSetting.controlEl.createEl("textarea");
    textarea.rows = 5;
    textarea.placeholder = "\u8F93\u5165\u6B63\u6587\u5185\u5BB9";
    textarea.style.width = "100%";
    textarea.style.resize = "vertical";
    textarea.style.overflowY = "auto";
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 280)}px`;
      this.contentValue = textarea.value;
    });
    const imageSetting = new import_obsidian.Setting(contentEl).setName("\u56FE\u7247");
    const fileInput = imageSetting.controlEl.createEl("input", { type: "file" });
    fileInput.multiple = true;
    fileInput.accept = "image/*";
    fileInput.addEventListener("change", () => {
      var _a;
      this.selectedFiles = Array.from((_a = fileInput.files) != null ? _a : []);
    });
    new import_obsidian.Setting(contentEl).addButton(
      (button) => button.setButtonText("\u53D1\u5E03").setCta().onClick(async () => {
        await this.handleSubmit();
      })
    );
  }
  onClose() {
    this.modalEl.removeClass("moments-create-modal");
    this.contentEl.empty();
  }
  async handleSubmit() {
    try {
      const now = /* @__PURE__ */ new Date();
      const createdAt = this.formatDateTime(now);
      const mdTime = this.formatMarkdownFileTime(now);
      const imageTime = this.formatImageFileTime(now);
      const titleForFilename = this.sanitizeFileName(this.titleValue || "\u672A\u547D\u540D");
      const attachmentsFolder = this.cleanFolderPath(this.plugin.settings.attachmentsPath);
      const momentsFolder = this.cleanFolderPath(this.plugin.settings.momentsPath);
      if (!attachmentsFolder) {
        throw new Error("Attachments path is empty");
      }
      if (!momentsFolder) {
        throw new Error("Moments path is empty");
      }
      await this.ensureFolderExists(attachmentsFolder);
      await this.ensureFolderExists(momentsFolder);
      const imageLinks = [];
      for (const file of this.selectedFiles) {
        const buffer = await file.arrayBuffer();
        const ext = this.getFileExtension(file.name);
        const imageName = `IMG-${imageTime}-${this.randomDigits(4)}${ext}`;
        const imagePath = (0, import_obsidian.normalizePath)(`${attachmentsFolder}/${imageName}`);
        await this.app.vault.createBinary(imagePath, buffer);
        imageLinks.push(`![[${imagePath}]]`);
      }
      const frontmatter = [
        "---",
        `\u6807\u9898: ${serializeFrontmatterString(this.titleValue || "")}`,
        `\u5730\u70B9: ${serializeFrontmatterString(this.locationValue || "")}`,
        `\u521B\u5EFA\u65F6\u95F4: ${createdAt}`,
        `\u66F4\u65B0\u65F6\u95F4: ${createdAt}`,
        "---"
      ].join("\n");
      const body = this.contentValue.trimEnd();
      const imagesBlock = imageLinks.join("\n");
      const contentSection = `## \u6B63\u6587
${body || "\uFF08\u65E0\u6B63\u6587\uFF09"}`;
      const imageSection = `## \u56FE\u7247
${imagesBlock || "\uFF08\u65E0\u56FE\u7247\uFF09"}`;
      const commentsSection = "## \u8BC4\u8BBA\u533A";
      const markdown = `${frontmatter}

${contentSection}

${imageSection}

${commentsSection}
`;
      const mdFileName = `Moments-${mdTime}-${titleForFilename}.md`;
      const mdFilePath = (0, import_obsidian.normalizePath)(`${momentsFolder}/${mdFileName}`);
      await this.app.vault.create(mdFilePath, markdown);
      new import_obsidian.Notice("Moments \u53D1\u5E03\u6210\u529F");
      this.close();
    } catch (error) {
      console.error(error);
      new import_obsidian.Notice("\u53D1\u5E03\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u914D\u7F6E\u6216\u6587\u4EF6\u540D\u662F\u5426\u51B2\u7A81");
    }
  }
  openMapPicker() {
    const mapUrl = this.getMapPickerUrl();
    try {
      window.open(mapUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error(error);
      new import_obsidian.Notice("\u65E0\u6CD5\u6253\u5F00\u5730\u56FE\uFF0C\u8BF7\u68C0\u67E5\u7CFB\u7EDF\u662F\u5426\u5141\u8BB8\u6253\u5F00\u5916\u90E8\u94FE\u63A5");
    }
  }
  getMapPickerUrl() {
    const markdownLink = parseMarkdownLink(this.locationValue);
    if (markdownLink) {
      return markdownLink.url;
    }
    const query = this.locationValue.trim();
    if (query) {
      return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
    }
    return "https://maps.apple.com/";
  }
  cleanFolderPath(path) {
    return this.plugin.cleanFolderPath(path);
  }
  async ensureFolderExists(folderPath) {
    if (!folderPath) return;
    const parts = folderPath.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder && !(folder instanceof import_obsidian.TFolder)) {
      throw new Error(`Path is not a folder: ${folderPath}`);
    }
  }
  sanitizeFileName(value) {
    return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "\u672A\u547D\u540D";
  }
  getFileExtension(fileName) {
    const idx = fileName.lastIndexOf(".");
    return idx >= 0 ? fileName.slice(idx) : ".png";
  }
  randomDigits(length) {
    const min = Math.pow(10, Math.max(1, length) - 1);
    const max = Math.pow(10, Math.max(1, length)) - 1;
    return `${Math.floor(Math.random() * (max - min + 1)) + min}`;
  }
  pad(value) {
    return value.toString().padStart(2, "0");
  }
  formatDateTime(date) {
    const yyyy = date.getFullYear();
    const mm = this.pad(date.getMonth() + 1);
    const dd = this.pad(date.getDate());
    const hh = this.pad(date.getHours());
    const mi = this.pad(date.getMinutes());
    const ss = this.pad(date.getSeconds());
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }
  formatMarkdownFileTime(date) {
    const yyyy = date.getFullYear();
    const mm = this.pad(date.getMonth() + 1);
    const dd = this.pad(date.getDate());
    const hh = this.pad(date.getHours());
    const mi = this.pad(date.getMinutes());
    const ss = this.pad(date.getSeconds());
    return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
  }
  formatImageFileTime(date) {
    const yyyy = date.getFullYear();
    const mm = this.pad(date.getMonth() + 1);
    const dd = this.pad(date.getDate());
    const hh = this.pad(date.getHours());
    const mi = this.pad(date.getMinutes());
    const ss = this.pad(date.getSeconds());
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  }
};
var MomentsSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "obsidian-moments \u8BBE\u7F6E" });
    new import_obsidian.Setting(containerEl).setName("Moments \u5B58\u50A8\u8DEF\u5F84").setDesc("\u7528\u4E8E\u4FDD\u5B58\u6BCF\u6761 Moments \u8BB0\u5F55\u7684 .md \u6587\u4EF6\u76EE\u5F55").addText(
      (text) => text.setPlaceholder("\u4F8B\u5982\uFF1AMoments/\u8BB0\u5F55/").setValue(this.plugin.settings.momentsPath).onChange(async (value) => {
        this.plugin.settings.momentsPath = value.trim() || DEFAULT_SETTINGS.momentsPath;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u56FE\u7247\u9644\u4EF6\u5B58\u50A8\u8DEF\u5F84").setDesc("\u7528\u4E8E\u4FDD\u5B58\u901A\u8FC7\u63D2\u4EF6\u4E0A\u4F20\u7684\u56FE\u7247\u6587\u4EF6").addText(
      (text) => text.setPlaceholder("\u4F8B\u5982\uFF1AMoments/Attachments/").setValue(this.plugin.settings.attachmentsPath).onChange(async (value) => {
        this.plugin.settings.attachmentsPath = value.trim() || DEFAULT_SETTINGS.attachmentsPath;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u5C55\u793A\u987A\u5E8F").setDesc("\u6309\u521B\u5EFA\u65F6\u95F4\u6392\u5E8F\uFF1A\u6B63\u5E8F\u6216\u5012\u5E8F").addDropdown(
      (dropdown) => dropdown.addOption("desc", "\u5012\u5E8F\uFF08\u6700\u65B0\u5728\u524D\uFF09").addOption("asc", "\u6B63\u5E8F\uFF08\u6700\u65E9\u5728\u524D\uFF09").setValue(this.plugin.settings.order).onChange(async (value) => {
        this.plugin.settings.order = value === "asc" ? "asc" : "desc";
        await this.plugin.saveSettings();
      })
    );
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CreateMomentModal,
  DEFAULT_SETTINGS,
  MomentsSettingTab
});
