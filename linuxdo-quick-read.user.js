// ==UserScript==
// @name         LinuxDo 辅助工具
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  LinuxDo 论坛辅助工具：快速标记未读回复为已读，支持未读帖子随机浏览
// @author       Assistant
// @match        https://linux.do/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 应用状态管理
    const state = {
        panel: null,
        isProcessing: false,
        isBrowsing: false,
        speed: 'NORMAL',
        isAutoMode: true,
        isCollapsed: false,
        unreadCount: 20,
        lastUrl: location.href,
        lastTopicId: null  // 添加最后访问的话题ID
    };

    // 配置
    const config = {
        speeds: {
            NORMAL: { delay: 200, name: '正常' },
            FAST: { delay: 100, name: '快速' },
            TURBO: { delay: 50, name: '极速' }
        },
        storage: {
            speed: 'linuxdo-speed',
            autoMode: 'linuxdo-auto-mode',
            collapsed: 'linuxdo-collapsed',
            unreadCount: 'linuxdo-unread-count'
        }
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

        // 获取页面类型
        getPageType: () => {
            const path = location.pathname;
            if (path.includes('/t/topic/')) return 'topic';
            if (path.includes('/latest') || path.includes('/unread') || path === '/') return 'list';
            return 'other';
        },

        // 提取话题ID
        getTopicId: () => {
            const path = location.pathname;
            const match = path.match(/\/t\/topic\/(\d+)/);
            return match ? match[1] : null;
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
                setTimeout(() => topicProcessor.checkAndProcess(), 500);
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
            ui.updateStopButton(true); // 启用停止按钮

            const replies = this.getRepliesNeedMarking();
            const topicInfo = this.getTopicInfo();
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

            if (!topicInfo || !csrfToken || replies.length === 0) {
                ui.updateStatus(replies.length === 0 ? '✅ 无需标记' : '❌ 获取信息失败', replies.length === 0 ? 'green' : 'red');
                state.isProcessing = false;
                ui.updateStopButton(false); // 禁用停止按钮
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
            ui.updateStopButton(false); // 禁用停止按钮
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

    // 未读帖子浏览器
    const unreadBrowser = {

        async getUnreadTopics() {
            const topics = [];

            try {
                if (location.pathname.includes('/unread')) {
                    // 直接从当前页面获取
                    console.log('从当前未读页面获取帖子');
                    const topicRows = document.querySelectorAll('table tbody tr');

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
                                topics.push({
                                    title: title.length > 40 ? title.substring(0, 40) + '...' : title,
                                    url: mainTitleLink.href
                                });
                            }
                        }
                    });
                } else {
                    // 使用隐藏iframe获取未读页面（参考旧版本方法）
                    ui.updateStatus('正在获取未读帖子...', '#007cbb');
                    console.log('通过隐藏iframe获取未读页面');

                    // 在新的隐藏iframe中加载未读页面
                    const iframe = document.createElement('iframe');
                    iframe.style.cssText = 'position: fixed; top: -1000px; left: -1000px; width: 1px; height: 1px; opacity: 0; pointer-events: none;';
                    iframe.src = '/unread';
                    document.body.appendChild(iframe);

                    // 等待iframe加载完成
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            document.body.removeChild(iframe);
                            reject(new Error('加载未读页面超时'));
                        }, 10000);

                        iframe.onload = () => {
                            clearTimeout(timeout);
                            try {
                                const doc = iframe.contentDocument || iframe.contentWindow.document;
                                const topicRows = doc.querySelectorAll('table tbody tr');
                                console.log('iframe中找到的行数:', topicRows.length);

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
                                            topics.push({
                                                title: title.length > 40 ? title.substring(0, 40) + '...' : title,
                                                url: url
                                            });
                                        }
                                    }
                                });

                                document.body.removeChild(iframe);
                                resolve();
                            } catch (error) {
                                document.body.removeChild(iframe);
                                reject(error);
                            }
                        };

                        iframe.onerror = () => {
                            clearTimeout(timeout);
                            document.body.removeChild(iframe);
                            reject(new Error('加载未读页面失败'));
                        };
                    });
                }

                console.log('总共找到未读帖子:', topics.length);

                // 如果没有找到任何帖子，提供用户提示
                if (topics.length === 0) {
                    ui.updateStatus('❌ 未找到未读帖子', 'red');
                    console.log('建议：请先手动访问 /unread 页面确认是否有未读帖子');
                }
            } catch (error) {
                console.error('获取未读帖子失败:', error);
                ui.updateStatus(`❌ 获取失败: ${error.message}`, 'red');
            }

            return utils.shuffle(topics);
        },

        async browseTopicInIframe(topic) {
            return new Promise(resolve => {
                const iframe = document.createElement('iframe');
                iframe.style.cssText = 'position:fixed;top:-1000px;left:-1000px;width:1px;height:1px;opacity:0;';
                iframe.src = topic.url;

                const cleanup = () => {
                    try { document.body.removeChild(iframe); } catch (e) {}
                    resolve();
                };

                iframe.onload = () => setTimeout(cleanup, 3000);
                iframe.onerror = cleanup;
                setTimeout(cleanup, 8000);

                document.body.appendChild(iframe);
            });
        },

        async start() {
            if (state.isBrowsing) return;
            state.isBrowsing = true;
            ui.updateBrowseButtons(true); // 更新按钮状态

            const topics = await this.getUnreadTopics();
            if (topics.length === 0) {
                ui.updateStatus('❌ 未找到未读帖子', 'red');
                state.isBrowsing = false;
                ui.updateBrowseButtons(false); // 恢复按钮状态
                return;
            }

            const targetCount = Math.min(state.unreadCount, topics.length);
            ui.updateStatus(`开始浏览 ${targetCount} 个帖子...`, '#007cbb');

            for (let i = 0; i < targetCount && state.isBrowsing; i++) {
                const topic = topics[i];
                ui.updateStatus(`浏览中 (${i + 1}/${targetCount}): ${topic.title}`, '#007cbb');

                await this.browseTopicInIframe(topic);

                if (i < targetCount - 1 && state.isBrowsing) {
                    await utils.delay(1000);
                }
            }

            ui.updateStatus(state.isBrowsing ? `✅ 完成！浏览了 ${targetCount} 个帖子` : '⏹️ 已停止',
                           state.isBrowsing ? 'green' : 'orange');
            state.isBrowsing = false;
            ui.updateBrowseButtons(false); // 恢复按钮状态
        },

        stop() {
            state.isBrowsing = false;
            ui.updateStatus('⏹️ 未读帖子浏览已停止', 'orange');
            ui.updateBrowseButtons(false); // 恢复按钮状态
        }
    };

    // UI管理器
    const ui = {
        panel: null,

        updateStatus(message, color = '#333') {
            const statusEl = this.panel?.querySelector('#status');
            if (statusEl) {
                const shortMessage = message.length > 30 ? message.substring(0, 27) + '...' : message;
                statusEl.textContent = shortMessage;
                statusEl.style.color = color;
                statusEl.title = message;
            }
        },

        updateStopButton(enabled) {
            const stopBtn = this.panel?.querySelector('#stop-btn');
            if (stopBtn) {
                stopBtn.disabled = !enabled;
                stopBtn.style.opacity = enabled ? '1' : '0.5';
                stopBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
            }
        },

        updateBrowseButtons(isBrowsing) {
            const startBtn = this.panel?.querySelector('#start-browse-btn');
            const stopBtn = this.panel?.querySelector('#stop-browse-btn');

            if (startBtn) {
                startBtn.disabled = isBrowsing;
                startBtn.style.opacity = isBrowsing ? '0.5' : '1';
                startBtn.style.cursor = isBrowsing ? 'not-allowed' : 'pointer';
            }

            if (stopBtn) {
                stopBtn.disabled = !isBrowsing;
                stopBtn.style.opacity = isBrowsing ? '1' : '0.5';
                stopBtn.style.cursor = isBrowsing ? 'pointer' : 'not-allowed';
            }
        },

        updateModeButtons() {
            if (!this.panel) return;
            const autoBtn = this.panel.querySelector('#auto-mode-btn');
            const manualBtn = this.panel.querySelector('#manual-mode-btn');
            const manualStartBtn = this.panel.querySelector('#manual-start-btn');

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
            const panelBody = this.panel?.querySelector('#panel-body');
            const toggleBtn = this.panel?.querySelector('#toggle-panel');

            if (panelBody && toggleBtn) {
                panelBody.style.display = state.isCollapsed ? 'none' : 'block';
                toggleBtn.textContent = state.isCollapsed ? '▶' : '▼';
                toggleBtn.title = state.isCollapsed ? '展开' : '收起';
            }
        },

        createPanel() {
            if (this.panel) return;

            const pageType = utils.getPageType();
            const isListPage = pageType === 'list';

            this.panel = document.createElement('div');
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
                        ${isListPage ? this.createUnreadBrowseControls() : ''}
                        ${this.createTopicControls()}
                    </div>
                </div>
            `;

            document.body.appendChild(this.panel);
            this.bindEvents();

            // 初始化按钮状态
            this.updateStopButton(false);
            this.updateBrowseButtons(false);
        },

        createUnreadBrowseControls() {
            return `
                <div style="margin-bottom:6px;border-top:1px solid #eee;padding-top:6px;">
                    <div style="font-size:10px;color:#666;margin-bottom:3px;">📖 增加浏览的话题:</div>
                    <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                        <input type="number" id="unread-count" value="${state.unreadCount}" min="1" max="50" style="width:40px;padding:2px;border:1px solid #ddd;border-radius:2px;font-size:10px;">
                        <span style="font-size:10px;color:#666;">个未读话题</span>
                    </div>
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

            // 基本控制
            this.panel.querySelector('#close-panel').onclick = () => this.removePanel();
            this.panel.querySelector('#toggle-panel').onclick = (e) => {
                e.stopPropagation();
                stateManager.toggleCollapsed();
            };
            this.panel.querySelector('#panel-header').onclick = (e) => {
                if (!['close-panel', 'toggle-panel'].includes(e.target.id)) {
                    stateManager.toggleCollapsed();
                }
            };

            // 模式切换
            this.panel.querySelector('#auto-mode-btn').onclick = () => stateManager.setAutoMode(true);
            this.panel.querySelector('#manual-mode-btn').onclick = () => stateManager.setAutoMode(false);

            const manualStartBtn = this.panel.querySelector('#manual-start-btn');
            if (manualStartBtn) {
                manualStartBtn.onclick = () => topicProcessor.processUnread();
            }

            // 速度选择
            this.panel.querySelectorAll('input[name="speed"]').forEach(radio => {
                radio.onchange = (e) => {
                    if (e.target.checked) stateManager.setSpeed(e.target.value);
                };
            });

            // 停止按钮
            this.panel.querySelector('#stop-btn').onclick = () => {
                if (state.isProcessing) {
                    state.isProcessing = false;
                    this.updateStatus('⏹️ 已停止', 'orange');
                    this.updateStopButton(false);
                }
            };

            // 未读帖子浏览控制
            const unreadCountInput = this.panel.querySelector('#unread-count');
            const startBrowseBtn = this.panel.querySelector('#start-browse-btn');
            const stopBrowseBtn = this.panel.querySelector('#stop-browse-btn');

            if (unreadCountInput) {
                unreadCountInput.onchange = (e) => {
                    state.unreadCount = Math.max(1, Math.min(50, parseInt(e.target.value) || 20));
                    utils.storage.set('unreadCount', state.unreadCount);
                };
            }

            if (startBrowseBtn) startBrowseBtn.onclick = () => unreadBrowser.start();
            if (stopBrowseBtn) stopBrowseBtn.onclick = () => unreadBrowser.stop();
        },

        removePanel() {
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

            // 防止重复初始化
            if (window.linuxDoHelperInitialized) {
                console.log('LinuxDo 辅助工具已经初始化过，跳过重复初始化');
                return;
            }
            window.linuxDoHelperInitialized = true;

            console.log('🚀 LinuxDo 辅助工具启动');

            stateManager.init();

            // 初始化当前话题ID
            state.lastTopicId = utils.getTopicId();

            ui.createPanel();

            const pageType = utils.getPageType();

            // 减少初始化延迟，让面板更快显示
            setTimeout(() => {
                if (pageType === 'topic') {
                    if (state.isAutoMode) {
                        topicProcessor.checkAndProcess();
                    } else {
                        ui.updateStatus('✅ 手动模式已就绪', 'green');
                    }
                } else if (pageType === 'list') {
                    ui.updateStatus('✅ 未读帖子浏览功能已就绪', 'green');
                } else {
                    ui.updateStatus('✅ LinuxDo 辅助工具已就绪', 'green');
                }
            }, 200);

            this.setupUrlMonitoring();
        },

        setupUrlMonitoring() {
            let lastUrl = location.href;

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

                    // 只有当话题ID发生变化时才重新初始化
                    if (needReinit) {
                        console.log('话题ID发生变化，重新初始化面板');
                        state.lastTopicId = currentTopicId; // 只有在重新初始化时才更新话题ID
                        ui.removePanel();
                        // 重置初始化标志，允许重新初始化
                        window.linuxDoHelperInitialized = false;
                        window['linuxdo-helper-script'] = false;
                        // 减少延迟，快速重新初始化
                        setTimeout(() => this.init(), 300);
                    } else {
                        console.log('同一话题内切换，不重新初始化面板');
                        // 同一话题内，只更新状态显示，不更新lastTopicId
                        if (utils.getPageType() === 'topic') {
                            if (state.isAutoMode) {
                                setTimeout(() => {
                                    if (!state.isProcessing) {
                                        topicProcessor.checkAndProcess();
                                    }
                                }, 500);
                            } else {
                                ui.updateStatus('✅ 手动模式已就绪', 'green');
                            }
                        }
                    }
                }
            };

            // 定时检查URL变化
            setInterval(checkUrlChange, 1000);

            // 监听浏览器前进后退
            window.addEventListener('popstate', () => {
                setTimeout(checkUrlChange, 100);
            });

            // 监听链接点击
            document.addEventListener('click', (e) => {
                const link = e.target.closest('a');
                if (link?.href?.includes('/t/topic/')) {
                    setTimeout(checkUrlChange, 500);
                }
            });
        }
    };

    // 启动应用 - 确保在页面加载完成后立即初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // 稍微延迟以确保页面元素完全加载
            setTimeout(() => app.init(), 100);
        });
    } else {
        // 页面已经加载完成，立即初始化
        setTimeout(() => app.init(), 100);
    }

    // 暴露到全局作用域（用于调试）
    window.linuxDoHelper = {
        state,
        config,
        utils,
        stateManager,
        topicProcessor,
        unreadBrowser,
        ui,
        app
    };


})();
