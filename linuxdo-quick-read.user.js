// ==UserScript==
// @name         LinuxDo 未读回复快速阅读助手
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  快速阅读 LinuxDo 论坛话题中的未读回复为已读状态，支持界面调节速度
// @author       Assistant
// @match        https://linux.do/t/topic/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

/*
 * LinuxDo 未读回复快速标记助手
 *
 * 功能：
 * - 自动检测未读回复并标记为已读
 * - 支持界面调节处理速度
 * - 实时显示处理进度
 *
 * 使用说明：
 * - 脚本会在话题页面自动启动
 * - 可在界面中选择处理速度
 * - 建议首次使用选择"正常"或"慢速"
 */

(function() {
    'use strict';

    console.log('🚀 LinuxDo 未读回复快速标记助手已启动');

    let controlPanel = null;
    let isProcessing = false;
    let currentSpeed = 'NORMAL'; // 默认速度
    let isCollapsed = false; // 侧边栏是否收起
    let lastInitUrl = ''; // 记录上次初始化的URL，防止重复初始化

    // ========== 速度设置 ==========
    // 可调节的处理速度配置
    const SPEED_CONFIG = {
        // 预设速度模式
        NORMAL: { delay: 200, name: '正常', desc: '0.2秒' },
        FAST: { delay: 100, name: '快速', desc: '0.1秒' },
        TURBO: { delay: 50, name: '极速', desc: '0.05秒' },
        CRAZY: { delay: 25, name: '疯狂', desc: '0.025秒' }
    };

    // 获取当前速度配置
    function getCurrentSpeedConfig() {
        return SPEED_CONFIG[currentSpeed] || SPEED_CONFIG.NORMAL;
    }

    // 设置速度
    function setSpeed(speed) {
        if (SPEED_CONFIG[speed]) {
            currentSpeed = speed;
            // 保存到本地存储
            localStorage.setItem('linuxdo-quick-read-speed', speed);
            console.log(`速度已设置为: ${SPEED_CONFIG[speed].name}`);
        }
    }

    // 从本地存储加载速度设置
    function loadSpeedSetting() {
        const savedSpeed = localStorage.getItem('linuxdo-quick-read-speed');
        if (savedSpeed && SPEED_CONFIG[savedSpeed]) {
            currentSpeed = savedSpeed;
        }
    }
    // ========== 速度设置结束 ==========

    // 获取CSRF token
    function getCSRFToken() {
        const csrfToken = document.querySelector('meta[name="csrf-token"]');
        return csrfToken ? csrfToken.content : null;
    }

    // 获取话题ID和当前位置
    function getTopicInfo() {
        const urlMatch = window.location.pathname.match(/\/t\/topic\/(\d+)(?:\/(\d+))?/);
        if (!urlMatch) return null;

        return {
            topicId: urlMatch[1],
            currentPosition: urlMatch[2] ? parseInt(urlMatch[2]) : 1
        };
    }

    // 获取总回复数
    function getTotalReplies() {
        const timelineReplies = document.querySelector('.timeline-replies');
        if (timelineReplies) {
            const text = timelineReplies.textContent.trim();
            const match = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (match) {
                return {
                    current: parseInt(match[1]),
                    total: parseInt(match[2])
                };
            }
        }

        // 备用方法：通过帖子数量计算
        const posts = document.querySelectorAll('article[data-post-id], [data-post-number]');
        return {
            current: posts.length,
            total: posts.length
        };
    }

    // 获取需要标记的回复列表（基于位置计算）
    function getRepliesNeedMarking() {
        const topicInfo = getTopicInfo();
        if (!topicInfo) return [];

        const replyInfo = getTotalReplies();
        const currentPos = topicInfo.currentPosition;
        const totalReplies = replyInfo.total;

        console.log('话题信息:', {
            topicId: topicInfo.topicId,
            currentPosition: currentPos,
            totalReplies: totalReplies,
            needToMark: totalReplies - currentPos
        });

        // 计算需要标记的回复数量
        const needToMarkCount = Math.max(0, totalReplies - currentPos);

        if (needToMarkCount === 0) {
            return [];
        }

        // 生成需要标记的帖子ID列表（从当前位置+1开始到总数）
        const repliesNeedMarking = [];
        for (let i = currentPos + 1; i <= totalReplies; i++) {
            repliesNeedMarking.push({
                id: i.toString(),
                position: i
            });
        }

        return repliesNeedMarking;
    }

    // 调用API标记单个帖子为已读
    async function markPostAsRead(postId, topicId, csrfToken) {
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
                    timings: {
                        [`${postId}`]: 3000
                    }
                })
            });

            return response.ok;
        } catch (error) {
            console.error(`标记帖子 ${postId} 失败:`, error);
            return false;
        }
    }

    // 批量标记回复为已读（基于位置计算）
    async function markUnreadAsRead() {
        if (isProcessing) return;
        isProcessing = true;
        updateButtonStates();

        const repliesNeedMarking = getRepliesNeedMarking();
        const topicInfo = getTopicInfo();
        const csrfToken = getCSRFToken();

        console.log('检测到的信息:', {
            repliesNeedMarking: repliesNeedMarking.length,
            topicId: topicInfo?.topicId,
            currentPosition: topicInfo?.currentPosition,
            csrfToken: csrfToken ? '已获取' : '未获取'
        });

        if (!topicInfo || !topicInfo.topicId) {
            updateStatus('❌ 获取话题ID失败', 'red');
            isProcessing = false;
            return;
        }

        if (!csrfToken) {
            updateStatus('❌ 获取token失败', 'red');
            isProcessing = false;
            return;
        }

        if (repliesNeedMarking.length === 0) {
            updateStatus('✅ 无需标记', 'green');
            isProcessing = false;
            return;
        }

        const speedConfig = getCurrentSpeedConfig();
        updateStatus(`处理中... (${speedConfig.name})`, '#007cbb');

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < repliesNeedMarking.length && isProcessing; i++) {
            const reply = repliesNeedMarking[i];
            updateStatus(`${i + 1}/${repliesNeedMarking.length} (${speedConfig.name})`, '#007cbb');

            const success = await markPostAsRead(reply.id, topicInfo.topicId, csrfToken);
            if (success) {
                successCount++;
                console.log(`✅ 成功标记位置 ${reply.position} 为已读`);
            } else {
                errorCount++;
                console.error(`❌ 标记位置 ${reply.position} 失败`);
            }

            // 使用配置的延迟时间
            if (i < repliesNeedMarking.length - 1 && isProcessing) { // 最后一个不需要延迟
                await new Promise(resolve => setTimeout(resolve, speedConfig.delay));
            }
        }

        // 显示结果
        if (!isProcessing) {
            updateStatus('⏹️ 已停止', 'orange');
        } else if (errorCount === 0) {
            updateStatus(`✅ 完成 ${successCount}个`, 'green');
        } else {
            updateStatus(`⚠️ ${successCount}成功 ${errorCount}失败`, 'orange');
        }

        isProcessing = false;
        updateButtonStates();
    }

    // 检测需要标记的回复数量并自动开始处理
    function checkAndAutoProcess() {
        // 如果已经在处理中，不要重复检测
        if (isProcessing) {
            console.log('正在处理中，跳过重复检测');
            return 0;
        }

        const repliesNeedMarking = getRepliesNeedMarking();
        const count = repliesNeedMarking.length;
        const topicInfo = getTopicInfo();
        const replyInfo = getTotalReplies();

        console.log('检测结果:', {
            currentPosition: topicInfo?.currentPosition || 1,
            totalReplies: replyInfo.total,
            needToMark: count
        });

        if (count === 0) {
            updateStatus('✅ 无需标记', 'green');
        } else {
            updateStatus(`发现 ${count} 个回复`, '#007cbb');
            // 延迟1秒后自动开始处理
            setTimeout(() => {
                // 再次检查是否还在同一个页面且没有在处理
                if (!isProcessing && window.location.href === lastInitUrl) {
                    markUnreadAsRead();
                }
            }, 1000);
        }

        return count;
    }

    // 创建控制面板
    function createControlPanel() {
        if (controlPanel) return;

        controlPanel = document.createElement('div');
        controlPanel.id = 'linuxdo-quick-read-panel';

        // 从本地存储加载收起状态
        const savedCollapsed = localStorage.getItem('linuxdo-quick-read-collapsed') === 'true';
        isCollapsed = savedCollapsed;

        // 生成速度单选框选项（紧凑布局）
        const speedRadios = Object.keys(SPEED_CONFIG).map(key => {
            const config = SPEED_CONFIG[key];
            return `
                <label style="display: inline-flex; align-items: center; margin-right: 8px; cursor: pointer; font-size: 11px; white-space: nowrap;">
                    <input type="radio" name="speed" value="${key}" ${key === currentSpeed ? 'checked' : ''}
                           style="margin-right: 3px; cursor: pointer; transform: scale(0.8);">
                    <span style="color: #333;">${config.name}</span>
                </label>
            `;
        }).join('');

        const panelContent = `
            <div id="panel-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; cursor: pointer;">
                <h3 style="margin: 0; color: #28a745; font-size: 12px;">⚡ 快速阅读助手</h3>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <button id="toggle-panel" style="background: none; border: none; font-size: 12px; cursor: pointer; color: #666; padding: 2px 4px;" title="${isCollapsed ? '展开' : '收起'}">
                        ${isCollapsed ? '▶' : '▼'}
                    </button>
                    <button id="close-panel" style="background: none; border: none; font-size: 14px; cursor: pointer; color: #666; padding: 0; width: 16px; height: 16px;" title="关闭">×</button>
                </div>
            </div>

            <div id="panel-body" style="display: ${isCollapsed ? 'none' : 'block'};">
                <div style="margin-bottom: 6px;">
                    <div style="font-size: 10px; color: #666; margin-bottom: 3px;">速度:</div>
                    <div id="speed-radios" style="display: flex; flex-wrap: wrap; gap: 2px;">
                        ${speedRadios}
                    </div>
                </div>

                <div id="status" style="padding: 4px 6px; background: #f8f9fa; border-radius: 3px; font-size: 11px; line-height: 1.3; margin-bottom: 6px; min-height: 16px;">
                    检测中...
                </div>

                <div style="text-align: center;">
                    <button id="stop-btn" style="padding: 3px 8px; background: #dc3545; color: white; border: none; border-radius: 3px; font-size: 10px; cursor: pointer;" disabled>
                        停止
                    </button>
                </div>
            </div>
        `;

        controlPanel.innerHTML = `
            <div style="position: fixed; top: 10px; right: 10px; z-index: 10000; background: rgba(255,255,255,0.95); border: 1px solid #28a745; border-radius: 6px; padding: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); font-family: Arial, sans-serif; width: 200px; backdrop-filter: blur(5px);">
                ${panelContent}
            </div>
        `;

        document.body.appendChild(controlPanel);

        // 绑定事件
        document.getElementById('close-panel').onclick = () => {
            controlPanel.remove();
            controlPanel = null;
        };

        // 收起/展开按钮事件
        document.getElementById('toggle-panel').onclick = (e) => {
            e.stopPropagation();
            togglePanel();
        };

        // 点击标题栏也可以收起/展开
        document.getElementById('panel-header').onclick = (e) => {
            if (e.target.id !== 'close-panel' && e.target.id !== 'toggle-panel') {
                togglePanel();
            }
        };

        // 速度单选框事件
        const speedRadioInputs = controlPanel.querySelectorAll('input[name="speed"]');
        speedRadioInputs.forEach(radio => {
            radio.onchange = (e) => {
                if (e.target.checked) {
                    setSpeed(e.target.value);
                    console.log(`速度已切换为: ${SPEED_CONFIG[e.target.value].name}`);
                }
            };
        });

        // 停止按钮事件
        document.getElementById('stop-btn').onclick = () => {
            if (isProcessing) {
                updateStatus('⏹️ 已停止', 'orange');
                isProcessing = false;
            }
        };

        updateSpeedDisplay();
    }

    // 切换面板收起/展开状态
    function togglePanel() {
        isCollapsed = !isCollapsed;
        const panelBody = document.getElementById('panel-body');
        const toggleBtn = document.getElementById('toggle-panel');

        if (panelBody && toggleBtn) {
            if (isCollapsed) {
                panelBody.style.display = 'none';
                toggleBtn.textContent = '▶';
                toggleBtn.title = '展开';
            } else {
                panelBody.style.display = 'block';
                toggleBtn.textContent = '▼';
                toggleBtn.title = '收起';
            }

            // 保存状态到本地存储
            localStorage.setItem('linuxdo-quick-read-collapsed', isCollapsed.toString());
        }
    }

    // 更新状态显示
    function updateStatus(message, color = '#333') {
        if (!controlPanel) return;
        const statusEl = document.getElementById('status');
        if (statusEl) {
            // 缩短状态消息以适应紧凑界面
            let shortMessage = message;
            if (message.length > 30) {
                shortMessage = message.substring(0, 27) + '...';
            }
            statusEl.textContent = shortMessage;
            statusEl.style.color = color;
            statusEl.title = message; // 完整消息显示在tooltip中
        }
        updateButtonStates();
    }

    // 更新速度显示
    function updateSpeedDisplay() {
        if (!controlPanel) return;
        const speedRadios = controlPanel.querySelectorAll('input[name="speed"]');
        speedRadios.forEach(radio => {
            radio.checked = radio.value === currentSpeed;
        });
    }

    // 更新按钮状态
    function updateButtonStates() {
        if (!controlPanel) return;
        const stopBtn = document.getElementById('stop-btn');
        const speedRadios = controlPanel.querySelectorAll('input[name="speed"]');

        if (stopBtn) {
            if (isProcessing) {
                stopBtn.disabled = false;
                stopBtn.style.opacity = '1';
                // 处理时禁用速度选择
                speedRadios.forEach(radio => {
                    radio.disabled = true;
                    radio.parentElement.style.opacity = '0.6';
                });
            } else {
                stopBtn.disabled = true;
                stopBtn.style.opacity = '0.6';
                // 非处理时启用速度选择
                speedRadios.forEach(radio => {
                    radio.disabled = false;
                    radio.parentElement.style.opacity = '1';
                });
            }
        }
    }

    // 初始化
    function init() {
        const currentUrl = window.location.href;

        // 检查是否在话题页面
        if (!window.location.pathname.includes('/t/topic/')) {
            console.log('不在话题页面，跳过初始化');
            return;
        }

        // 防止在同一个页面重复初始化
        if (lastInitUrl === currentUrl && controlPanel) {
            console.log('同一页面已初始化，跳过重复初始化');
            return;
        }

        console.log('在话题页面，开始初始化:', currentUrl);
        lastInitUrl = currentUrl;

        // 如果正在处理，先停止
        if (isProcessing) {
            isProcessing = false;
            console.log('停止之前的处理');
        }

        // 加载速度设置
        loadSpeedSetting();

        // 创建控制面板
        createControlPanel();

        // 延迟一点时间等待页面完全加载后再检测
        setTimeout(() => {
            // 再次确认还在同一个页面
            if (window.location.href === currentUrl) {
                checkAndAutoProcess();
            }
        }, 500);
    }

    // 暴露到全局作用域
    window.linuxDoQuickRead = {
        checkAndAutoProcess,
        markUnreadAsRead,
        getRepliesNeedMarking,
        getTopicInfo,
        getTotalReplies,
        setSpeed,
        getCurrentSpeedConfig,
        init
    };

    // 页面加载完成后立即初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // 页面已经加载完成，立即初始化
        init();
    }

    // 监听页面变化（仅监听真正的页面跳转）
    let lastUrl = location.href;
    let urlCheckTimer = null;

    // 提取话题ID从URL
    function getTopicIdFromUrl(url) {
        const match = url.match(/\/t\/topic\/(\d+)/);
        return match ? match[1] : null;
    }

    // 使用定时器检查URL变化，只关注话题ID变化
    function checkUrlChange() {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            console.log('检测到URL变化:', currentUrl);

            // 提取话题ID
            const lastTopicId = getTopicIdFromUrl(lastUrl);
            const currentTopicId = getTopicIdFromUrl(currentUrl);

            console.log('话题ID变化检查:', {
                lastUrl: lastUrl,
                currentUrl: currentUrl,
                lastTopicId: lastTopicId,
                currentTopicId: currentTopicId
            });

            lastUrl = currentUrl;

            // 只有当话题ID发生变化时才重新初始化
            if (currentTopicId && lastTopicId !== currentTopicId) {
                console.log('检测到话题ID变化，重新初始化');

                // 如果正在处理，先停止
                if (isProcessing) {
                    isProcessing = false;
                    console.log('话题变化，停止当前处理');
                }

                // 移除旧的控制面板
                if (controlPanel) {
                    controlPanel.remove();
                    controlPanel = null;
                }

                // 重置初始化URL
                lastInitUrl = '';

                // URL变化后延迟一点时间等待页面内容加载，然后重新初始化
                setTimeout(init, 1200);
            } else if (!currentTopicId && controlPanel) {
                // 如果离开话题页面，清理控制面板
                console.log('离开话题页面，清理控制面板');
                if (isProcessing) {
                    isProcessing = false;
                }
                controlPanel.remove();
                controlPanel = null;
                lastInitUrl = '';
            } else if (currentTopicId && lastTopicId === currentTopicId) {
                // 同一话题内的位置变化，不需要重新初始化
                console.log('同一话题内的位置变化，无需重新初始化');
            }
        }
    }

    // 每秒检查一次URL变化（轻量级检查）
    urlCheckTimer = setInterval(checkUrlChange, 1000);

    // 监听浏览器前进后退按钮
    window.addEventListener('popstate', () => {
        console.log('检测到浏览器前进/后退');
        setTimeout(checkUrlChange, 100);
    });

    // 监听点击链接事件（针对SPA应用的路由跳转）
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href && link.href.includes('/t/topic/')) {
            console.log('检测到话题链接点击:', link.href);
            // 延迟检查URL变化
            setTimeout(checkUrlChange, 500);
        }
    });

    console.log('✅ LinuxDo 未读回复快速标记助手初始化完成');
})();
