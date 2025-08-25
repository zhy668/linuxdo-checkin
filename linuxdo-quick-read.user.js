// ==UserScript==
// @name         LinuxDo 辅助工具
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  LinuxDo 论坛辅助工具：快速标记未读回复为已读，支持随机冷门帖子浏览
// @author       Assistant
// @match        https://linux.do/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 🚫 关键修复：防止在iframe中执行脚本
    if (window !== window.top) {
        console.log('🚫 检测到在iframe中，跳过LinuxDo辅助工具脚本执行');
        return;
    }

    console.log('✅ 在主窗口中，开始执行LinuxDo辅助工具脚本');

    // 应用状态管理
    const state = {
        isProcessing: false,
        isBrowsing: false,
        speed: 'NORMAL',
        isAutoMode: true,
        isCollapsed: false,
        unreadCount: 20,
        concurrentThreads: 3,  // 并发线程数
        lastUrl: location.href,
        lastTopicId: null,  // 添加最后访问的话题ID
        // 性能优化相关
        urlCheckInterval: null,
        eventListeners: [],
        cachedElements: new Map()
    };

    // 配置
    const config = {
        speeds: {
            NORMAL: { delay: 100, name: '正常' },
            FAST: { delay: 50, name: '快速' },
            TURBO: { delay: 20, name: '极速' }
        },
        storage: {
            speed: 'linuxdo-speed',
            autoMode: 'linuxdo-auto-mode',
            collapsed: 'linuxdo-collapsed',
            unreadCount: 'linuxdo-unread-count',
            concurrentThreads: 'linuxdo-concurrent-threads'
        }
    };

    // 常量定义
    const CONSTANTS = {
        DELAYS: {
            INIT: 100,
            REINIT: 300,
            AUTO_CHECK: 500,
            STATUS_UPDATE: 200
        },
        TIMEOUTS: {
            IFRAME_LOAD: 10000,
            IFRAME_BROWSE: 8000,
            IFRAME_STAY: 3000
        },
        IFRAME_STYLE: 'position:fixed;top:-1000px;left:-1000px;width:1px;height:1px;opacity:0;pointer-events:none;'
    };

    // 工具函数
    const utils = {
        // 随机打乱数组
        shuffle: (array) => {
            const shuffled = [...array];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
        },

        // 延迟函数
        delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

        // 获取页面类型 - 简化逻辑，在linux.do域名下显示全部功能
        getPageType: () => {
            const path = location.pathname;

            // 话题页面
            if (path.includes('/t/topic/')) return 'topic';

            // 其他页面都视为列表页面，显示全部功能
            return 'list';
        },

        // 提取话题ID
        getTopicId: () => {
            const path = location.pathname;
            const match = path.match(/\/t\/topic\/(\d+)/);
            return match ? match[1] : null;
        },

        // 统一的iframe创建函数
        createIframe: (url, timeout = CONSTANTS.TIMEOUTS.IFRAME_LOAD) => {
            return new Promise((resolve, reject) => {
                const iframe = document.createElement('iframe');
                iframe.style.cssText = CONSTANTS.IFRAME_STYLE;
                iframe.src = url;
                document.body.appendChild(iframe);

                const timeoutId = setTimeout(() => {
                    utils.cleanupIframe(iframe);
                    reject(new Error(`iframe加载超时: ${url}`));
                }, timeout);

                iframe.onload = () => {
                    clearTimeout(timeoutId);
                    resolve(iframe);
                };

                iframe.onerror = () => {
                    clearTimeout(timeoutId);
                    utils.cleanupIframe(iframe);
                    reject(new Error(`iframe加载失败: ${url}`));
                };
            });
        },

        // 统一的iframe清理函数
        cleanupIframe: (iframe) => {
            try {
                if (iframe && iframe.parentNode) {
                    iframe.parentNode.removeChild(iframe);
                }
            } catch (e) {
                console.warn('iframe清理失败:', e);
            }
        },

        // 防抖函数
        debounce: (func, wait) => {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        // 存储操作
        storage: {
            get: (key, defaultValue) => {
                const value = localStorage.getItem(config.storage[key]);
                return value !== null ? JSON.parse(value) : defaultValue;
            },
            set: (key, value) => localStorage.setItem(config.storage[key], JSON.stringify(value))
        }
    };

    // 状态管理
    const stateManager = {
        init() {
            state.speed = utils.storage.get('speed', 'NORMAL');
            state.isAutoMode = utils.storage.get('autoMode', true);
            state.isCollapsed = utils.storage.get('collapsed', false);
            state.unreadCount = utils.storage.get('unreadCount', 20);
            state.concurrentThreads = utils.storage.get('concurrentThreads', 3);
        },

        setSpeed(speed) {
            if (config.speeds[speed]) {
                state.speed = speed;
                utils.storage.set('speed', speed);
            }
        },

        setAutoMode(auto) {
            state.isAutoMode = auto;
            utils.storage.set('autoMode', auto);
            ui.updateModeButtons();

            if (auto && utils.getPageType() === 'topic' && !state.isProcessing) {
                setTimeout(() => topicProcessor.checkAndProcess(), CONSTANTS.DELAYS.AUTO_CHECK);
            }
        },

        toggleCollapsed() {
            state.isCollapsed = !state.isCollapsed;
            utils.storage.set('collapsed', state.isCollapsed);
            ui.updateCollapsed();
        }
    };

    // 话题处理器
    const topicProcessor = {
        getTopicInfo() {
            const match = location.pathname.match(/\/t\/topic\/(\d+)(?:\/(\d+))?/);
            return match ? {
                topicId: match[1],
                currentPosition: match[2] ? parseInt(match[2]) : 1
            } : null;
        },

        getTotalReplies() {
            const timelineReplies = document.querySelector('.timeline-replies');
            if (timelineReplies) {
                const match = timelineReplies.textContent.match(/(\d+)\s*\/\s*(\d+)/);
                if (match) return { current: parseInt(match[1]), total: parseInt(match[2]) };
            }
            const posts = document.querySelectorAll('article[data-post-id], [data-post-number]');
            return { current: posts.length, total: posts.length };
        },

        getRepliesNeedMarking() {
            const topicInfo = this.getTopicInfo();
            if (!topicInfo) return [];

            const replyInfo = this.getTotalReplies();

            const replies = [];
            for (let i = topicInfo.currentPosition + 1; i <= replyInfo.total; i++) {
                replies.push({ id: i.toString(), position: i });
            }
            return replies;
        },

        async markPostAsRead(postId, topicId, csrfToken) {
            try {
                const response = await fetch('/topics/timings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify({
                        topic_id: parseInt(topicId),
                        topic_time: Math.floor(Date.now() / 1000),
                        timings: { [`${postId}`]: 3000 }
                    })
                });
                return response.ok;
            } catch (error) {
                console.error(`标记帖子 ${postId} 失败:`, error);
                return false;
            }
        },

        async processUnread() {
            if (state.isProcessing) return;
            state.isProcessing = true;
            ui.updateStatus('处理中...', '#007cbb');
            ui.updateStopButton(true);

            const replies = this.getRepliesNeedMarking();
            const topicInfo = this.getTopicInfo();
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

            if (!topicInfo || !csrfToken || replies.length === 0) {
                ui.updateStatus(replies.length === 0 ? '✅ 无需标记' : '❌ 获取信息失败', replies.length === 0 ? 'green' : 'red');
                state.isProcessing = false;
                ui.updateStopButton(false);
                return;
            }

            const speedConfig = config.speeds[state.speed];
            let successCount = 0;

            for (let i = 0; i < replies.length && state.isProcessing; i++) {
                const reply = replies[i];
                ui.updateStatus(`${i + 1}/${replies.length} (${speedConfig.name})`, '#007cbb');

                const success = await this.markPostAsRead(reply.id, topicInfo.topicId, csrfToken);
                if (success) successCount++;

                if (i < replies.length - 1 && state.isProcessing) {
                    await utils.delay(speedConfig.delay);
                }
            }

            ui.updateStatus(state.isProcessing ? `✅ 完成 ${successCount}个` : '⏹️ 已停止',
                           state.isProcessing ? 'green' : 'orange');
            state.isProcessing = false;
            ui.updateStopButton(false);
        },

        checkAndProcess() {
            if (state.isProcessing) return;
            const replies = this.getRepliesNeedMarking();
            if (replies.length === 0) {
                ui.updateStatus('✅ 无需标记', 'green');
            } else {
                ui.updateStatus(`发现 ${replies.length} 个回复`, '#007cbb');
                setTimeout(() => {
                    if (!state.isProcessing && location.href === state.lastUrl) {
                        this.processUnread();
                    }
                }, 1000);
            }
        }
    };

    // 冷门帖子浏览器
    const coldTopicBrowser = {

        // 从页面文档中提取话题（包含浏览量和回复数信息）
        extractTopicsFromPage(doc, topics) {
            const topicRows = doc.querySelectorAll('table tbody tr');
            console.log(`从页面提取到 ${topicRows.length} 行数据`);

            topicRows.forEach((row) => {
                const titleLinks = row.querySelectorAll('a[href*="/t/topic/"]');
                let mainTitleLink = null;

                // 找到主要的话题标题链接
                for (let link of titleLinks) {
                    if (link.closest('h2') || (!mainTitleLink && link.textContent.trim().length > 5)) {
                        mainTitleLink = link;
                        break;
                    }
                }

                if (mainTitleLink && !mainTitleLink.href.includes('#')) {
                    const title = mainTitleLink.textContent.trim();
                    if (title) {
                        const url = mainTitleLink.href.startsWith('http') ?
                                   mainTitleLink.href :
                                   `https://linux.do${mainTitleLink.href}`;

                        // 提取浏览量信息
                        let views = 0;
                        const viewsElement = row.querySelector('.views .number');
                        if (viewsElement) {
                            const viewsText = viewsElement.textContent.trim();
                            // 处理 k 单位（如 1.2k = 1200）
                            if (viewsText.includes('k')) {
                                views = Math.floor(parseFloat(viewsText) * 1000);
                            } else {
                                views = parseInt(viewsText) || 0;
                            }
                        }

                        // 提取回复数信息
                        let replies = 0;
                        const repliesElement = row.querySelector('.posts .number');
                        if (repliesElement) {
                            replies = parseInt(repliesElement.textContent.trim()) || 0;
                        }

                        topics.push({
                            title: title.length > 40 ? title.substring(0, 40) + '...' : title,
                            url: url,
                            views: views,
                            replies: replies
                        });
                    }
                }
            });
        },

        // 通过iframe获取指定页面的话题
        async getTopicsFromUrl(url) {
            try {
                const iframe = await utils.createIframe(url);
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                const topics = [];
                this.extractTopicsFromPage(doc, topics);
                utils.cleanupIframe(iframe);
                return topics;
            } catch (error) {
                console.error(`获取页面话题失败: ${url}`, error);
                throw error;
            }
        },

        // 判断是否为冷门帖子
        isColdTopic(topic) {
            const views = topic.views || 0;
            const replies = topic.replies || 0;

            // 冷门帖子标准：浏览量5-800，回复数0-30
            return views >= 5 && views <= 800 && replies >= 0 && replies <= 30;
        },

        async getColdTopics() {
            const allTopics = [];
            const coldTopics = [];

            try {
                if (location.pathname.includes('/latest')) {
                    // 直接从当前页面获取
                    console.log('从当前最新页面获取帖子');
                    this.extractTopicsFromPage(document, allTopics);
                } else {
                    // 使用隐藏iframe获取最新页面，支持多页获取
                    ui.updateStatus('正在获取最新帖子...', '#007cbb');
                    console.log('通过隐藏iframe获取最新页面');

                    // 尝试获取多页数据，最多获取5页以获得更多样本
                    const maxPages = 5;
                    for (let page = 0; page < maxPages && allTopics.length < 200; page++) {
                        try {
                            const url = page === 0 ? '/latest?per_page=50' : `/latest?page=${page}&per_page=50`;
                            ui.updateStatus(`正在获取第 ${page + 1} 页最新帖子...`, '#007cbb');

                            const pageTopics = await this.getTopicsFromUrl(url);
                            console.log(`第 ${page + 1} 页获取到 ${pageTopics.length} 个帖子`);

                            if (pageTopics.length === 0) {
                                console.log(`第 ${page + 1} 页没有更多帖子，停止获取`);
                                break;
                            }

                            allTopics.push(...pageTopics);

                            // 页面间添加小延迟
                            if (page < maxPages - 1) {
                                await utils.delay(CONSTANTS.DELAYS.AUTO_CHECK);
                            }
                        } catch (error) {
                            console.error(`获取第 ${page + 1} 页失败:`, error);
                            if (page === 0) {
                                // 如果第一页就失败了，抛出错误
                                throw error;
                            }
                            // 其他页面失败则继续
                            break;
                        }
                    }
                }

                console.log('总共获取到帖子:', allTopics.length);

                // 筛选冷门帖子
                for (const topic of allTopics) {
                    if (this.isColdTopic(topic)) {
                        coldTopics.push(topic);
                    }
                }

                console.log('筛选出冷门帖子:', coldTopics.length);

                // 如果没有找到任何冷门帖子，提供用户提示
                if (coldTopics.length === 0) {
                    ui.updateStatus('❌ 未找到冷门帖子', 'red');
                    console.log('建议：尝试调整冷门帖子的筛选标准');
                }
            } catch (error) {
                console.error('获取冷门帖子失败:', error);
                ui.updateStatus(`❌ 获取失败: ${error.message}`, 'red');
            }

            return utils.shuffle(coldTopics);
        },

        async browseTopicInIframe(topic) {
            try {
                const iframe = await utils.createIframe(topic.url, CONSTANTS.TIMEOUTS.IFRAME_BROWSE);
                // 模拟浏览停留时间
                await utils.delay(CONSTANTS.TIMEOUTS.IFRAME_STAY);
                utils.cleanupIframe(iframe);
            } catch (error) {
                console.warn(`浏览话题失败: ${topic.url}`, error);
                // 即使失败也继续，不中断整个浏览流程
            }
        },

        // 多线程浏览话题
        async browseTopicsConcurrently(topics, startIndex, endIndex) {
            const promises = [];
            const actualEnd = Math.min(endIndex, topics.length);

            for (let i = startIndex; i < actualEnd && state.isBrowsing; i++) {
                const topic = topics[i];
                promises.push(this.browseTopicInIframe(topic));

                // 控制并发数量，避免创建过多iframe
                if (promises.length >= state.concurrentThreads || i === actualEnd - 1) {
                    await Promise.allSettled(promises);
                    promises.length = 0; // 清空数组

                    // 批次间添加小延迟
                    if (i < actualEnd - 1 && state.isBrowsing) {
                        await utils.delay(500);
                    }
                }
            }
        },

        async start() {
            if (state.isBrowsing) return;
            state.isBrowsing = true;
            ui.updateBrowseButtons(true);

            const topics = await this.getColdTopics();
            if (topics.length === 0) {
                ui.updateStatus('❌ 未找到冷门帖子', 'red');
                state.isBrowsing = false;
                ui.updateBrowseButtons(false);
                return;
            }

            const targetCount = Math.min(state.unreadCount, topics.length);
            ui.updateStatus(`开始浏览 ${targetCount} 个冷门帖子 (${state.concurrentThreads}线程)...`, '#007cbb');

            // 使用多线程并发浏览
            const batchSize = state.concurrentThreads;
            for (let i = 0; i < targetCount && state.isBrowsing; i += batchSize) {
                const endIndex = Math.min(i + batchSize, targetCount);
                const currentBatch = topics.slice(i, endIndex);

                ui.updateStatus(`浏览中 (${i + 1}-${endIndex}/${targetCount}): ${currentBatch.map(t => t.title.substring(0, 15)).join(', ')}...`, '#007cbb');

                await this.browseTopicsConcurrently(topics, i, endIndex);

                // 批次间添加延迟
                if (endIndex < targetCount && state.isBrowsing) {
                    await utils.delay(1000);
                }
            }

            ui.updateStatus(state.isBrowsing ? `✅ 完成！浏览了 ${targetCount} 个冷门帖子` : '⏹️ 已停止',
                           state.isBrowsing ? 'green' : 'orange');
            state.isBrowsing = false;
            ui.updateBrowseButtons(false);
        },

        stop() {
            state.isBrowsing = false;
            ui.updateStatus('⏹️ 冷门帖子浏览已停止', 'orange');
            ui.updateBrowseButtons(false);
        }
    };

    // UI管理器
    const ui = {
        panel: null,

        // 缓存DOM元素查询
        getCachedElement(selector) {
            if (!state.cachedElements.has(selector)) {
                const element = this.panel?.querySelector(selector);
                if (element) {
                    state.cachedElements.set(selector, element);
                }
            }
            return state.cachedElements.get(selector);
        },

        // 清理元素缓存
        clearElementCache() {
            state.cachedElements.clear();
        },

        updateStatus(message, color = '#333') {
            const statusEl = this.getCachedElement('#status');
            if (statusEl) {
                const shortMessage = message.length > 30 ? message.substring(0, 27) + '...' : message;
                statusEl.textContent = shortMessage;
                statusEl.style.color = color;
                statusEl.title = message;
            }
        },

        // 防抖的状态更新 - 延迟初始化
        get debouncedUpdateStatus() {
            if (!this._debouncedUpdateStatus) {
                this._debouncedUpdateStatus = utils.debounce((message, color) => {
                    this.updateStatus(message, color);
                }, 100);
            }
            return this._debouncedUpdateStatus;
        },

        // 统一的按钮状态更新函数
        updateButtonState(selector, enabled) {
            const button = this.getCachedElement(selector);
            if (button) {
                button.disabled = !enabled;
                button.style.opacity = enabled ? '1' : '0.5';
                button.style.cursor = enabled ? 'pointer' : 'not-allowed';
            }
        },

        updateStopButton(enabled) {
            this.updateButtonState('#stop-btn', enabled);
        },

        updateBrowseButtons(isBrowsing) {
            this.updateButtonState('#start-browse-btn', !isBrowsing);
            this.updateButtonState('#stop-browse-btn', isBrowsing);
        },

        updateModeButtons() {
            if (!this.panel) return;
            const autoBtn = this.getCachedElement('#auto-mode-btn');
            const manualBtn = this.getCachedElement('#manual-mode-btn');
            const manualStartBtn = this.getCachedElement('#manual-start-btn');

            if (autoBtn && manualBtn) {
                autoBtn.style.background = state.isAutoMode ? '#28a745' : '#6c757d';
                autoBtn.textContent = state.isAutoMode ? '✓ 自动' : '自动';
                manualBtn.style.background = !state.isAutoMode ? '#007cbb' : '#6c757d';
                manualBtn.textContent = !state.isAutoMode ? '✓ 手动' : '手动';
            }

            if (manualStartBtn) {
                manualStartBtn.style.display = state.isAutoMode ? 'none' : 'block';
            }
        },

        updateCollapsed() {
            const panelBody = this.getCachedElement('#panel-body');
            const toggleBtn = this.getCachedElement('#toggle-panel');

            if (panelBody && toggleBtn) {
                panelBody.style.display = state.isCollapsed ? 'none' : 'block';
                toggleBtn.textContent = state.isCollapsed ? '▶' : '▼';
                toggleBtn.title = state.isCollapsed ? '展开' : '收起';
            }
        },

        createPanel() {

            this.panel = document.createElement('div');
            // 添加唯一标识符
            this.panel.setAttribute('data-linuxdo-helper-panel', 'true');
            this.panel.innerHTML = `
                <div style="position:fixed;top:10px;right:10px;z-index:10000;background:rgba(255,255,255,0.95);border:1px solid #28a745;border-radius:6px;padding:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);font-family:Arial,sans-serif;width:200px;backdrop-filter:blur(5px);">
                    <div id="panel-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;cursor:pointer;">
                        <h3 style="margin:0;color:#28a745;font-size:12px;">🛠️ LinuxDo 辅助工具</h3>
                        <div style="display:flex;align-items:center;gap:4px;">
                            <button id="toggle-panel" style="background:none;border:none;font-size:12px;cursor:pointer;color:#666;padding:2px 4px;" title="${state.isCollapsed ? '展开' : '收起'}">
                                ${state.isCollapsed ? '▶' : '▼'}
                            </button>
                            <button id="close-panel" style="background:none;border:none;font-size:14px;cursor:pointer;color:#666;padding:0;width:16px;height:16px;" title="关闭">×</button>
                        </div>
                    </div>
                    <div id="panel-body" style="display:${state.isCollapsed ? 'none' : 'block'};">
                        ${this.createColdTopicBrowseControls()}
                        ${this.createTopicControls()}
                    </div>
                </div>
            `;

            document.body.appendChild(this.panel);
            this.bindEvents();

            // 初始化按钮状态
            this.updateStopButton(false);
            this.updateBrowseButtons(false);

            console.log('面板创建完成');
        },

        createColdTopicBrowseControls() {
            return `
                <div style="margin-bottom:6px;border-top:1px solid #eee;padding-top:6px;">
                    <div style="font-size:10px;color:#666;margin-bottom:3px;">� 随机冷门帖子浏览:</div>
                    <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                        <input type="number" id="unread-count" value="${state.unreadCount}" min="1" max="100" style="width:40px;padding:2px;border:1px solid #ddd;border-radius:2px;font-size:10px;">
                        <span style="font-size:10px;color:#666;">个话题</span>
                        <input type="number" id="concurrent-threads" value="${state.concurrentThreads}" min="1" max="10" style="width:30px;padding:2px;border:1px solid #ddd;border-radius:2px;font-size:10px;">
                        <span style="font-size:10px;color:#666;">线程</span>
                    </div>
                    <div style="font-size:9px;color:#999;margin-bottom:4px;">筛选标准: 浏览量5-800, 回复数0-30</div>
                    <div style="display:flex;gap:4px;">
                        <button id="start-browse-btn" style="padding:3px 8px;background:#17a2b8;color:white;border:none;border-radius:3px;font-size:10px;cursor:pointer;flex:1;">开始浏览</button>
                        <button id="stop-browse-btn" style="padding:3px 8px;background:#dc3545;color:white;border:none;border-radius:3px;font-size:10px;cursor:pointer;flex:1;" disabled>停止浏览</button>
                    </div>
                </div>
            `;
        },

        createTopicControls() {
            const speedRadios = Object.keys(config.speeds).map(key => {
                const speedConfig = config.speeds[key];
                return `
                    <label style="display:inline-flex;align-items:center;margin-right:8px;cursor:pointer;font-size:11px;white-space:nowrap;">
                        <input type="radio" name="speed" value="${key}" ${key === state.speed ? 'checked' : ''} style="margin-right:3px;cursor:pointer;transform:scale(0.8);">
                        <span style="color:#333;">${speedConfig.name}</span>
                    </label>
                `;
            }).join('');

            return `
                <div style="margin-bottom:6px;border-top:1px solid #eee;padding-top:6px;">
                    <div style="font-size:10px;color:#666;margin-bottom:3px;">⚡ 增加已读帖子:</div>
                    <div style="display:flex;gap:4px;margin-bottom:6px;">
                        <button id="auto-mode-btn" style="padding:3px 8px;background:${state.isAutoMode ? '#28a745' : '#6c757d'};color:white;border:none;border-radius:3px;font-size:10px;cursor:pointer;flex:1;">
                            ${state.isAutoMode ? '✓ 自动' : '自动'}
                        </button>
                        <button id="manual-mode-btn" style="padding:3px 8px;background:${!state.isAutoMode ? '#007cbb' : '#6c757d'};color:white;border:none;border-radius:3px;font-size:10px;cursor:pointer;flex:1;">
                            ${!state.isAutoMode ? '✓ 手动' : '手动'}
                        </button>
                    </div>
                    ${!state.isAutoMode ? `
                    <div style="text-align:center;margin-bottom:6px;">
                        <button id="manual-start-btn" style="padding:3px 12px;background:#007cbb;color:white;border:none;border-radius:3px;font-size:10px;cursor:pointer;">手动开始</button>
                    </div>
                    ` : ''}
                    <div style="margin-bottom:6px;">
                        <div style="font-size:10px;color:#666;margin-bottom:3px;">速度:</div>
                        <div style="display:flex;flex-wrap:wrap;gap:2px;">${speedRadios}</div>
                    </div>
                    <div id="status" style="padding:4px 6px;background:#f8f9fa;border-radius:3px;font-size:11px;line-height:1.3;margin-bottom:6px;min-height:16px;">检测中...</div>
                    <div style="text-align:center;">
                        <button id="stop-btn" style="padding:3px 8px;background:#dc3545;color:white;border:none;border-radius:3px;font-size:10px;cursor:pointer;" disabled>停止</button>
                    </div>
                </div>
            `;
        },

        bindEvents() {
            if (!this.panel) return;

            // 基本控制 - 先清理缓存，然后重新缓存元素
            this.clearElementCache();

            const closeBtn = this.getCachedElement('#close-panel');
            const toggleBtn = this.getCachedElement('#toggle-panel');
            const panelHeader = this.getCachedElement('#panel-header');

            if (closeBtn) closeBtn.onclick = () => this.removePanel();
            if (toggleBtn) {
                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    stateManager.toggleCollapsed();
                };
            }
            if (panelHeader) {
                panelHeader.onclick = (e) => {
                    if (!['close-panel', 'toggle-panel'].includes(e.target.id)) {
                        stateManager.toggleCollapsed();
                    }
                };
            }

            // 模式切换
            const autoModeBtn = this.getCachedElement('#auto-mode-btn');
            const manualModeBtn = this.getCachedElement('#manual-mode-btn');
            const manualStartBtn = this.getCachedElement('#manual-start-btn');

            if (autoModeBtn) autoModeBtn.onclick = () => stateManager.setAutoMode(true);
            if (manualModeBtn) manualModeBtn.onclick = () => stateManager.setAutoMode(false);
            if (manualStartBtn) manualStartBtn.onclick = () => topicProcessor.processUnread();

            // 速度选择
            const speedRadios = this.panel?.querySelectorAll('input[name="speed"]');
            if (speedRadios) {
                speedRadios.forEach(radio => {
                    radio.onchange = (e) => {
                        if (e.target.checked) stateManager.setSpeed(e.target.value);
                    };
                });
            }

            // 停止按钮
            const stopBtn = this.getCachedElement('#stop-btn');
            if (stopBtn) {
                stopBtn.onclick = () => {
                    if (state.isProcessing) {
                        state.isProcessing = false;
                        this.updateStatus('⏹️ 已停止', 'orange');
                        this.updateStopButton(false);
                    }
                };
            }

            // 未读帖子浏览控制
            const unreadCountInput = this.getCachedElement('#unread-count');
            const concurrentThreadsInput = this.getCachedElement('#concurrent-threads');
            const startBrowseBtn = this.getCachedElement('#start-browse-btn');
            const stopBrowseBtn = this.getCachedElement('#stop-browse-btn');

            if (unreadCountInput) {
                unreadCountInput.onchange = (e) => {
                    state.unreadCount = Math.max(1, Math.min(100, parseInt(e.target.value) || 20));
                    utils.storage.set('unreadCount', state.unreadCount);
                };
            }

            if (concurrentThreadsInput) {
                concurrentThreadsInput.onchange = (e) => {
                    state.concurrentThreads = Math.max(1, Math.min(10, parseInt(e.target.value) || 3));
                    utils.storage.set('concurrentThreads', state.concurrentThreads);
                };
            }

            if (startBrowseBtn) startBrowseBtn.onclick = () => coldTopicBrowser.start();
            if (stopBrowseBtn) stopBrowseBtn.onclick = () => coldTopicBrowser.stop();
        },

        removePanel() {
            // 清理元素缓存
            this.clearElementCache();

            // 移除当前面板
            if (this.panel) {
                this.panel.remove();
                this.panel = null;
            }
        }
    };

    // 应用管理器
    const app = {
        init() {
            if (!location.hostname.includes('linux.do')) return;

            console.log('🚀 LinuxDo 辅助工具启动');

            stateManager.init();

            // 初始化当前话题ID
            state.lastTopicId = utils.getTopicId();

            ui.createPanel();

            // 减少初始化延迟，让面板更快显示
            setTimeout(() => {
                const pageType = utils.getPageType();
                if (pageType === 'topic') {
                    if (state.isAutoMode) {
                        topicProcessor.checkAndProcess();
                    } else {
                        ui.updateStatus('✅ 手动模式已就绪', 'green');
                    }
                } else {
                    ui.updateStatus('✅ LinuxDo 辅助工具已就绪', 'green');
                }
            }, CONSTANTS.DELAYS.STATUS_UPDATE);

            this.setupUrlMonitoring();
        },

        cleanup() {
            // 清理所有可能的遗留元素
            ui.removePanel();

            // 清理事件监听器
            this.cleanupEventListeners();

            // 清理元素缓存
            ui.clearElementCache();

            console.log('清理完成');
        },

        setupUrlMonitoring() {
            let lastUrl = location.href;
            let checkCount = 0;

            const checkUrlChange = () => {
                if (location.href !== lastUrl && !state.isProcessing && !state.isBrowsing) {
                    const currentTopicId = utils.getTopicId();
                    const needReinit = currentTopicId !== state.lastTopicId;

                    console.log('检测到页面变化', {
                        oldUrl: lastUrl,
                        newUrl: location.href,
                        oldTopicId: state.lastTopicId,
                        newTopicId: currentTopicId,
                        needReinit
                    });

                    lastUrl = location.href;
                    state.lastUrl = lastUrl;

                    // 只更新状态，不重新初始化面板
                    console.log('页面变化，更新状态');
                    state.lastTopicId = currentTopicId;

                    if (utils.getPageType() === 'topic') {
                        if (state.isAutoMode) {
                            setTimeout(() => {
                                if (!state.isProcessing) {
                                    topicProcessor.checkAndProcess();
                                }
                            }, CONSTANTS.DELAYS.AUTO_CHECK);
                        } else {
                            ui.updateStatus('✅ 手动模式已就绪', 'green');
                        }
                    } else {
                        ui.updateStatus('✅ LinuxDo 辅助工具已就绪', 'green');
                    }

                    // 重置检查计数
                    checkCount = 0;
                } else {
                    // 增加检查计数，用于动态调整检查间隔
                    checkCount++;
                }
            };

            // 智能URL监控 - 根据活动情况调整检查频率
            const startUrlMonitoring = () => {
                if (state.urlCheckInterval) {
                    clearInterval(state.urlCheckInterval);
                }

                state.urlCheckInterval = setInterval(() => {
                    checkUrlChange();

                    // 如果长时间没有URL变化，降低检查频率
                    if (checkCount > 30) { // 30秒无变化
                        clearInterval(state.urlCheckInterval);
                        // 切换到低频检查模式
                        state.urlCheckInterval = setInterval(checkUrlChange, 5000); // 5秒检查一次
                    }
                }, 1000);
            };

            startUrlMonitoring();

            // 添加事件监听器并记录，便于清理
            const addEventListenerWithCleanup = (target, event, handler, options) => {
                target.addEventListener(event, handler, options);
                state.eventListeners.push({ target, event, handler, options });
            };

            // 监听浏览器前进后退
            addEventListenerWithCleanup(window, 'popstate', () => {
                setTimeout(checkUrlChange, 100);
                startUrlMonitoring(); // 重新启动高频监控
            });

            // 监听链接点击
            addEventListenerWithCleanup(document, 'click', (e) => {
                const link = e.target.closest('a');
                if (link?.href?.includes('/t/topic/')) {
                    setTimeout(checkUrlChange, 500);
                    startUrlMonitoring(); // 重新启动高频监控
                }
            });

            // 监听页面可见性变化，优化性能
            addEventListenerWithCleanup(document, 'visibilitychange', () => {
                if (document.hidden) {
                    // 页面隐藏时停止URL检查
                    if (state.urlCheckInterval) {
                        clearInterval(state.urlCheckInterval);
                        state.urlCheckInterval = null;
                    }
                } else {
                    // 页面显示时恢复URL检查
                    startUrlMonitoring();
                }
            });
        },

        // 清理事件监听器
        cleanupEventListeners() {
            state.eventListeners.forEach(({ target, event, handler, options }) => {
                target.removeEventListener(event, handler, options);
            });
            state.eventListeners = [];

            if (state.urlCheckInterval) {
                clearInterval(state.urlCheckInterval);
                state.urlCheckInterval = null;
            }
        }
    };



    // 启动应用
    app.init();

    // 暴露到全局作用域（用于调试）
    window.linuxDoHelper = {
        state,
        config,
        utils,
        stateManager,
        topicProcessor,
        coldTopicBrowser,
        ui,
        app
    };


})();
