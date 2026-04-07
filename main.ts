import {
	App,
	Modal,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	normalizePath,
} from "obsidian";

export type MomentsOrder = "asc" | "desc";

export interface MomentsSettings {
	momentsPath: string;
	attachmentsPath: string;
	order: MomentsOrder;
}

interface MomentItem {
	file: TFile;
	title: string;
	location: string;
	createdAt: string;
	comments: string[];
	body: string;
	images: string[];
}

interface MarkdownLink {
	label: string;
	url: string;
}

function parseMarkdownLink(value: string): MarkdownLink | null {
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
	} catch {
		return null;
	}
}

function serializeFrontmatterString(value: string): string {
	return JSON.stringify(value);
}

export const DEFAULT_SETTINGS: MomentsSettings = {
	momentsPath: "Moments/记录/",
	attachmentsPath: "Moments/Attachments/",
	order: "desc",
};

export default class ObsidianMomentsPlugin extends Plugin {
	settings!: MomentsSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MomentsSettingTab(this.app, this));
		this.addCommand({
			id: "create-moments",
			name: "创建 Moments",
			callback: () => {
				new CreateMomentModal(this.app, this).open();
			},
		});
		this.registerMarkdownCodeBlockProcessor("moments", async (_source, el, ctx) => {
			await this.renderMomentsFeed(el, ctx.sourcePath);
		});
	}

	onunload() {
		// 预留：后续如果注册视图、事件或命令，在此处释放。
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async renderMomentsFeed(containerEl: HTMLElement, currentSourcePath?: string) {
		containerEl.empty();
		const feedEl = containerEl.createDiv({ cls: "moments-feed" });

		const folderPath = this.cleanFolderPath(this.settings.momentsPath);
		if (!folderPath) {
			feedEl.createDiv({ text: "请先在插件设置中配置 Moments 存储路径。" });
			return;
		}

		const files = this.getMomentMarkdownFiles(folderPath, currentSourcePath);
		if (files.length === 0) {
			feedEl.createDiv({ text: "暂无 Moments 记录。" });
			return;
		}

		const items: MomentItem[] = [];
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

	private getMomentMarkdownFiles(folderPath: string, currentSourcePath?: string): TFile[] {
		const prefix = `${folderPath}/`;
		return this.app.vault.getFiles().filter((file) => {
			if (file.extension !== "md") return false;
			if (!file.path.startsWith(prefix)) return false;
			if (currentSourcePath && file.path === currentSourcePath) return false;
			return file.name.startsWith("Moments-");
		});
	}

	private async readMomentItem(file: TFile): Promise<MomentItem | null> {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter ?? {};
		if (!file.name.startsWith("Moments-")) {
			return null;
		}

		const title = typeof frontmatter["标题"] === "string" ? frontmatter["标题"] : file.basename;
		const location = typeof frontmatter["地点"] === "string" ? frontmatter["地点"] : "";
		const createdAt = typeof frontmatter["创建时间"] === "string" ? frontmatter["创建时间"] : "";

		const raw = await this.app.vault.read(file);
		const markdownBody = this.stripYamlFrontmatter(raw).trim();
		const body = this.extractContentSection(markdownBody);
		const images = this.extractImageLinks(markdownBody);
		const comments = this.extractCommentsFromMarkdown(markdownBody);

		return { file, title, location, createdAt, comments, body, images };
	}

	private stripYamlFrontmatter(content: string): string {
		return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
	}

	private extractImageLinks(content: string): string[] {
		const imageSection = this.extractTopLevelSection(content, "图片");
		const scope = imageSection ?? content;
		const result: string[] = [];
		this.forEachNonCodeSegment(scope, (segment) => {
			const regex = /!\[\[([^\]]+?)\]\]/g;
			let match: RegExpExecArray | null = null;
			while ((match = regex.exec(segment)) !== null) {
				const raw = match[1].split("|")[0].trim();
				if (raw) result.push(raw);
			}
		});
		return result;
	}

	private extractContentSection(content: string): string {
		const normalized = content.replace(/\r\n/g, "\n");
		const section = this.extractTopLevelSection(normalized, "正文");
		if (section !== null) {
			return section.trim();
		}
		return this.removeImageLinksFromBody(normalized).trim();
	}

	private extractTopLevelSection(content: string, headingName: string): string | null {
		const lines = content.replace(/\r\n/g, "\n").split("\n");
		const collected: string[] = [];
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

	private forEachNonCodeSegment(content: string, handler: (segment: string) => void) {
		const lines = content.replace(/\r\n/g, "\n").split("\n");
		let inFence = false;
		let fenceToken = "";
		let chunk: string[] = [];
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

	private renderMomentCard(parentEl: HTMLElement, item: MomentItem) {
		const cardEl = parentEl.createDiv({ cls: "moments-card" });

		const headerEl = cardEl.createDiv({ cls: "moments-card-header" });
		headerEl.createDiv({ cls: "moments-title", text: item.title || "未命名" });

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
			placeholder: "写评论...",
		});
		const submitCommentBtn = composerEl.createEl("button", { text: "发送", cls: "moments-comment-submit" });
		if (item.comments.length === 0) {
			commentsSectionEl.addClass("is-hidden");
		}

		const metaRowEl = cardEl.createDiv({ cls: "moments-meta-row" });
		const metaLeftEl = metaRowEl.createDiv({ cls: "moments-meta-left" });
		metaLeftEl.createDiv({ cls: "moments-time", text: item.createdAt || "未知时间" });
		const locationEl = metaLeftEl.createDiv({ cls: "moments-location" });
		locationEl.createSpan({ cls: "moments-location-icon", text: "📍" });
		this.renderLocationValue(locationEl, item.location);
		const actionsEl = metaRowEl.createDiv({ cls: "moments-actions" });
		const detailBtn = actionsEl.createEl("button", { text: "详情" });
		const commentBtn = actionsEl.createEl("button", { text: "评论" });

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
				new Notice("评论内容不能为空");
				return;
			}
			const now = new Date();
			const commentLine = `${this.formatCommentTime(now)} - ${commentText}`;
			try {
					await this.app.vault.process(item.file, (data) => {
						const normalized = data.replace(/\r\n/g, "\n").trimEnd();
						const commentItem = `- ${commentLine}`;
						if (!/^\s*##\s*评论区\s*$/m.test(normalized)) {
							return `${normalized}\n\n## 评论区\n${commentItem}\n`;
						}
						const commentSectionRegex = /(^##\s*评论区\s*$)([\s\S]*?)$/m;
						return normalized.replace(commentSectionRegex, (_m: string, heading: string, body: string) => {
							const sectionBody = body.trimEnd();
							if (!sectionBody) {
								return `${heading}\n${commentItem}`;
							}
							return `${heading}\n${sectionBody}\n${commentItem}`;
						}) + "\n";
					});
					item.comments.push(commentLine);
					this.renderCommentsList(commentsInlineListEl, item.comments);
					commentsSummaryEl.setText(this.formatCommentsSummaryText(item.comments.length));
					commentsSectionEl.removeClass("is-hidden");
					commentsDetailsEl.open = true;
					commentInput.value = "";
					new Notice("评论已添加");
				} catch (error) {
					console.error(error);
					new Notice("评论提交失败");
				}
		});
	}

	private renderCommentsList(containerEl: HTMLElement, comments: string[]) {
		containerEl.empty();
		if (comments.length === 0) {
			containerEl.createDiv({ cls: "moments-comment-empty", text: "暂无评论" });
			return;
		}
		for (const comment of comments) {
			containerEl.createDiv({ cls: "moments-comment-item", text: comment });
		}
	}

	private extractCommentsFromMarkdown(content: string): string[] {
		const commentsSection = this.extractTopLevelSection(content, "评论区");
		if (!commentsSection) return [];
		const comments: string[] = [];
		this.forEachNonCodeSegment(commentsSection, (segment) => {
			for (const line of segment.split("\n")) {
				const match = line.match(/^\s*-\s+(.+?)\s*$/);
				if (match) comments.push(match[1]);
			}
		});
		return comments;
	}

	private formatCommentsSummaryText(count: number): string {
		return `💬 ${count} 条评论`;
	}

	private removeImageLinksFromBody(content: string): string {
		const parts: string[] = [];
		this.forEachNonCodeSegment(content, (segment) => {
			parts.push(segment.replace(/!\[\[[^\]]+?\]\]/g, ""));
		});
		return parts.join("\n").trim();
	}

	resolveImageResourcePath(link: string, fromFile: TFile): string | null {
		const target = this.app.metadataCache.getFirstLinkpathDest(link, fromFile.path);
		if (!target) return null;
		return this.app.vault.adapter.getResourcePath(target.path);
	}

	private applyGridLayoutStyle(gridEl: HTMLElement, imgCount: number) {
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

	private parseDateTime(value: string): number {
		if (!value) return 0;
		const parsed = Date.parse(value.replace(" ", "T"));
		return Number.isNaN(parsed) ? 0 : parsed;
	}

	private renderLocationValue(locationEl: HTMLElement, location: string) {
		const trimmedLocation = location.trim();
		if (!trimmedLocation) {
			locationEl.appendText("未填写地点");
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
			href: markdownLink.url,
		});
		locationLinkEl.target = "_blank";
		locationLinkEl.rel = "noopener noreferrer";
		locationLinkEl.addEventListener("click", (event) => {
			event.preventDefault();
			window.open(markdownLink.url, "_blank", "noopener,noreferrer");
		});
	}

	private formatCommentTime(date: Date): string {
		const yyyy = date.getFullYear();
		const mm = this.pad(date.getMonth() + 1);
		const dd = this.pad(date.getDate());
		const hh = this.pad(date.getHours());
		const mi = this.pad(date.getMinutes());
		return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
	}

	private formatDateTime(date: Date): string {
		const yyyy = date.getFullYear();
		const mm = this.pad(date.getMonth() + 1);
		const dd = this.pad(date.getDate());
		const hh = this.pad(date.getHours());
		const mi = this.pad(date.getMinutes());
		const ss = this.pad(date.getSeconds());
		return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
	}

	private pad(value: number): string {
		return value.toString().padStart(2, "0");
	}

	cleanFolderPath(path: string): string {
		const trimmed = path
			.trim()
			.replace(/\\/g, "/")
			.replace(/^\/+/, "")
			.replace(/\/+$/, "");
		return trimmed ? normalizePath(trimmed) : "";
	}
}

export class CreateMomentModal extends Modal {
	plugin: ObsidianMomentsPlugin;
	titleValue = "";
	locationValue = "";
	contentValue = "";
	selectedFiles: File[] = [];

	constructor(app: App, plugin: ObsidianMomentsPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		this.modalEl.addClass("moments-create-modal");
		const { contentEl } = this;
		contentEl.empty();
		const modalContent = contentEl.closest(".modal-content") as HTMLElement | null;
		if (modalContent) {
			modalContent.style.maxHeight = "75vh";
			modalContent.style.overflowY = "auto";
		}

		contentEl.createEl("h2", { text: "创建 Moments" });

		new Setting(contentEl)
			.setName("标题")
			.addText((text) =>
				text.setPlaceholder("输入标题").onChange((value) => {
					this.titleValue = value.trim();
				}),
			);

		const locationSetting = new Setting(contentEl).setName("地点");
		locationSetting.controlEl.addClass("moments-location-control");
		locationSetting
			.addText((text) => {
				text.inputEl.addClass("moments-location-input");
				text.setPlaceholder("输入地点").onChange((value) => {
					this.locationValue = value.trim();
				});
			});

		if (Platform.isIosApp) {
			locationSetting.addButton((button) => {
				button.setButtonText("地图选址").onClick(() => {
					this.openMapPicker();
				});
				button.buttonEl.addClass("moments-map-picker-button");
			});
		}

		const contentSetting = new Setting(contentEl).setName("内容");
		const textarea = contentSetting.controlEl.createEl("textarea");
		textarea.rows = 5;
		textarea.placeholder = "输入正文内容";
		textarea.style.width = "100%";
		textarea.style.resize = "vertical";
		textarea.style.overflowY = "auto";
		textarea.addEventListener("input", () => {
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 280)}px`;
			this.contentValue = textarea.value;
		});

		const imageSetting = new Setting(contentEl).setName("图片");
		const fileInput = imageSetting.controlEl.createEl("input", { type: "file" });
		fileInput.multiple = true;
		fileInput.accept = "image/*";
		fileInput.addEventListener("change", () => {
			this.selectedFiles = Array.from(fileInput.files ?? []);
		});

		new Setting(contentEl).addButton((button) =>
			button.setButtonText("发布").setCta().onClick(async () => {
				await this.handleSubmit();
			}),
		);
	}

	onClose() {
		this.modalEl.removeClass("moments-create-modal");
		this.contentEl.empty();
	}

	private async handleSubmit() {
		try {
			const now = new Date();
			const createdAt = this.formatDateTime(now);
			const mdTime = this.formatMarkdownFileTime(now);
			const imageTime = this.formatImageFileTime(now);
			const titleForFilename = this.sanitizeFileName(this.titleValue || "未命名");

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

			const imageLinks: string[] = [];
			for (const file of this.selectedFiles) {
				const buffer = await file.arrayBuffer();
				const ext = this.getFileExtension(file.name);
				const imageName = `IMG-${imageTime}-${this.randomDigits(4)}${ext}`;
				const imagePath = normalizePath(`${attachmentsFolder}/${imageName}`);
				await this.app.vault.createBinary(imagePath, buffer);
				imageLinks.push(`![[${imagePath}]]`);
			}

			const frontmatter = [
				"---",
				`标题: ${serializeFrontmatterString(this.titleValue || "")}`,
				`地点: ${serializeFrontmatterString(this.locationValue || "")}`,
				`创建时间: ${createdAt}`,
				`更新时间: ${createdAt}`,
				"---",
			].join("\n");

		const body = this.contentValue.trimEnd();
		const imagesBlock = imageLinks.join("\n");
		const contentSection = `## 正文\n${body || "（无正文）"}`;
		const imageSection = `## 图片\n${imagesBlock || "（无图片）"}`;
		const commentsSection = "## 评论区";
		const markdown = `${frontmatter}\n\n${contentSection}\n\n${imageSection}\n\n${commentsSection}\n`;

			const mdFileName = `Moments-${mdTime}-${titleForFilename}.md`;
			const mdFilePath = normalizePath(`${momentsFolder}/${mdFileName}`);
			await this.app.vault.create(mdFilePath, markdown);

			new Notice("Moments 发布成功");
			this.close();
		} catch (error) {
			console.error(error);
			new Notice("发布失败，请检查路径配置或文件名是否冲突");
		}
	}

	private openMapPicker() {
		const mapUrl = this.getMapPickerUrl();
		try {
			window.open(mapUrl, "_blank", "noopener,noreferrer");
		} catch (error) {
			console.error(error);
			new Notice("无法打开地图，请检查系统是否允许打开外部链接");
		}
	}

	private getMapPickerUrl(): string {
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

	private cleanFolderPath(path: string): string {
		return this.plugin.cleanFolderPath(path);
	}

	private async ensureFolderExists(folderPath: string) {
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
		if (folder && !(folder instanceof TFolder)) {
			throw new Error(`Path is not a folder: ${folderPath}`);
		}
	}

	private sanitizeFileName(value: string): string {
		return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "未命名";
	}

	private getFileExtension(fileName: string): string {
		const idx = fileName.lastIndexOf(".");
		return idx >= 0 ? fileName.slice(idx) : ".png";
	}

	private randomDigits(length: number): string {
		const min = Math.pow(10, Math.max(1, length) - 1);
		const max = Math.pow(10, Math.max(1, length)) - 1;
		return `${Math.floor(Math.random() * (max - min + 1)) + min}`;
	}

	private pad(value: number): string {
		return value.toString().padStart(2, "0");
	}

	private formatDateTime(date: Date): string {
		const yyyy = date.getFullYear();
		const mm = this.pad(date.getMonth() + 1);
		const dd = this.pad(date.getDate());
		const hh = this.pad(date.getHours());
		const mi = this.pad(date.getMinutes());
		const ss = this.pad(date.getSeconds());
		return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
	}

	private formatMarkdownFileTime(date: Date): string {
		const yyyy = date.getFullYear();
		const mm = this.pad(date.getMonth() + 1);
		const dd = this.pad(date.getDate());
		const hh = this.pad(date.getHours());
		const mi = this.pad(date.getMinutes());
		const ss = this.pad(date.getSeconds());
		return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
	}

	private formatImageFileTime(date: Date): string {
		const yyyy = date.getFullYear();
		const mm = this.pad(date.getMonth() + 1);
		const dd = this.pad(date.getDate());
		const hh = this.pad(date.getHours());
		const mi = this.pad(date.getMinutes());
		const ss = this.pad(date.getSeconds());
		return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
	}
}

export class MomentsSettingTab extends PluginSettingTab {
	plugin: ObsidianMomentsPlugin;

	constructor(app: App, plugin: ObsidianMomentsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "obsidian-moments 设置" });

		new Setting(containerEl)
			.setName("Moments 存储路径")
			.setDesc("用于保存每条 Moments 记录的 .md 文件目录")
			.addText((text) =>
				text
					.setPlaceholder("例如：Moments/记录/")
					.setValue(this.plugin.settings.momentsPath)
					.onChange(async (value) => {
						this.plugin.settings.momentsPath = value.trim() || DEFAULT_SETTINGS.momentsPath;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("图片附件存储路径")
			.setDesc("用于保存通过插件上传的图片文件")
			.addText((text) =>
				text
					.setPlaceholder("例如：Moments/Attachments/")
					.setValue(this.plugin.settings.attachmentsPath)
					.onChange(async (value) => {
						this.plugin.settings.attachmentsPath = value.trim() || DEFAULT_SETTINGS.attachmentsPath;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("展示顺序")
			.setDesc("按创建时间排序：正序或倒序")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("desc", "倒序（最新在前）")
						.addOption("asc", "正序（最早在前）")
						.setValue(this.plugin.settings.order)
						.onChange(async (value) => {
							this.plugin.settings.order = value === "asc" ? "asc" : "desc";
							await this.plugin.saveSettings();
						}),
				);
	}
}
