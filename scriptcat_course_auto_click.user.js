// ==UserScript==
// @name         列表页自动播放未完成课程（串行处理）
// @namespace    http://tampermonkey.net/
// @version      0.7
// @description  串行处理未完成课程，监听播放完成事件，一次只打开一个页面
// @author       toughgj
// @match        https://zdkj.v.zzu.edu.cn/*
// @grant        none
// @updateURL    https://github.com/toughgj/hnskjry/blob/main/scriptcat_course_auto_click.user.js
// @downloadURL  https://github.com/toughgj/hnskjry/blob/main/scriptcat_course_auto_click.user.js
// @homepage     https://github.com/toughgj/hnskjry
// ==/UserScript==

(function() {
    'use strict';

    // 保存原始console.log
    const originalConsoleLog = console.log;

    // 配置参数
    const config = {
        // 播放完成的console提示关键词
        playCompleteKeywords: ['查找下一节按钮'],
        // 列表页面URL
        listPageUrl: 'https://zdkj.v.zzu.edu.cn/center',
        // 播放页面URL前缀
        playPagePrefix: 'https://zdkj.v.zzu.edu.cn/play',
        // 页面加载等待时间（毫秒）
        pageLoadDelay: 3000,
        // 检测播放完成的间隔时间（毫秒）
        checkInterval: 2000,
        // 最大等待时间（毫秒），防止单个课程卡住
        maxWaitTime: 7200000 // 2小时
    };

    // 应用状态管理
    const appState = {
        courseQueue: [], // 未完成课程队列
        selectedCourses: [], // 用户选择的课程
        currentCourse: null, // 当前处理的课程
        currentWindow: null, // 当前打开的窗口
        checkTimer: null, // 检测播放完成的定时器
        startTime: 0, // 当前课程开始处理的时间
        messageReceived: false, // 消息接收标记，防止重复处理
        lastProcessTime: 0, // 上次处理时间，用于控制刷新频率
        isConsoleOverridden: false, // 标记console.log是否已被重写
        isMessageListenerAdded: false, // 标记消息监听器是否已添加
        floatingWindow: null, // 漂浮窗口元素
        countdownTimer: null, // 倒计时定时器
        countdown: 10, // 倒计时秒数
        isPaused: false, // 是否暂停
        floatingWindowObserver: null, // 漂浮窗口的MutationObserver
        floatingWindowDragHandlers: null, // 漂浮窗口的拖拽事件处理函数
        playPageResources: null // 播放页面资源
    };

    /**
     * 初始化脚本
     */
    function initScript() {
        // 使用原始console.log输出，避免循环调用
        originalConsoleLog('脚本初始化...');
        
        // 判断当前页面类型
        if (isPlayPage()) {
            originalConsoleLog('当前是播放页面，设置播放完成检测...');
            setupPlayPageListener();
            return;
        }
        
        if (isListPage()) {
            originalConsoleLog('当前是课程列表页面，开始查找目标元素...');
            
            // 从localStorage中恢复课程队列
            const savedQueue = localStorage.getItem('courseQueue');
            if (savedQueue) {
                try {
                    appState.courseQueue = JSON.parse(savedQueue);
                    originalConsoleLog(`从localStorage中恢复了${appState.courseQueue.length}个未完成课程`);
                    // 清除localStorage中的课程队列
                    localStorage.removeItem('courseQueue');
                    // 直接开始处理下一个课程
                    startProcessing();
                    return;
                } catch (e) {
                    originalConsoleLog('恢复课程队列失败:', e.message);
                    localStorage.removeItem('courseQueue');
                }
            }
            
            setupListPage();
            return;
        }
        
        originalConsoleLog('当前页面不是目标页面，脚本不执行');
    }

    /**
     * 判断是否为列表页面
     * @returns {boolean} - 是否为列表页面
     */
    function isListPage() {
        // 使用更灵活的判断方式，支持带查询参数的URL
        return window.location.href.startsWith(config.listPageUrl) ||
               window.location.pathname.includes('/center');
    }

    /**
     * 判断是否为播放页面
     * @returns {boolean} - 是否为播放页面
     */
    function isPlayPage() {
        return window.location.href.startsWith(config.playPagePrefix);
    }

    /**
     * 创建左上角漂浮窗口
     */
    function createFloatingWindow() {
        // 如果已经存在漂浮窗口，先移除并清理资源
        if (appState.floatingWindow) {
            removeFloatingWindow();
        }
        
        // 查找上一页和下一页按钮，检查是否存在
        const hasPrevPage = !!document.querySelector('.prev.ng-binding');
        const hasNextPage = !!document.querySelector('.next.ng-binding');
        
        // 创建漂浮窗口元素
        appState.floatingWindow = document.createElement('div');
        appState.floatingWindow.id = 'scriptcat-floating-window';
        
        // 设置CSS样式
        appState.floatingWindow.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            width: 350px;
            background: rgba(255, 255, 255, 0.95);
            border: 2px solid #4CAF50;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 9999;
            font-family: Arial, sans-serif;
            color: #333;
            overflow: hidden;
        `;
        
        // 构建HTML结构
        appState.floatingWindow.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #4CAF50; color: white;">
                <h3 style="margin: 0; font-size: 14px;">自动播放控制</h3>
                <div style="display: flex; gap: 5px;">
                    <button id="collapse-btn" style="background: rgba(255, 255, 255, 0.2); color: white; border: none; border-radius: 4px; padding: 3px 6px; cursor: pointer; font-size: 12px;">折叠</button>
                    <button id="close-btn" style="background: rgba(255, 255, 255, 0.2); color: white; border: none; border-radius: 4px; padding: 3px 6px; cursor: pointer; font-size: 12px;">关闭</button>
                </div>
            </div>
            
            <div id="window-content" style="padding: 15px; max-height: 400px; overflow-y: auto;">
                <div style="margin-bottom: 15px;">
                    <div style="font-size: 14px; margin-bottom: 5px;">倒计时：<span id="countdown" style="font-size: 24px; font-weight: bold; color: #4CAF50;">${appState.countdown}</span>秒</div>
                    <div style="display: flex; gap: 10px;">
                        <button id="pause-btn" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer;">暂停</button>
                        <button id="play-btn" style="background: #4CAF50; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer;">开始</button>
                    </div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <label style="font-size: 14px;"><input type="checkbox" id="select-all" style="margin-right: 5px;"> 全选</label>
                        <div style="display: flex; gap: 10px;">
                            <button id="play-selected" style="background: #FF9800; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px;">播放选中</button>
                            <button id="play-all" style="background: #4CAF50; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px;">播放全部</button>
                        </div>
                    </div>
                    
                    <div id="course-list" style="max-height: 150px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 10px; background: #f9f9f9;">
                        ${appState.courseQueue.map((course, index) => `
                            <div style="margin-bottom: 8px; display: flex; align-items: center;">
                                <input type="checkbox" class="course-checkbox" data-index="${index}" style="margin-right: 10px;">
                                <span style="font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    ${index + 1}. ${course.learnBtn.closest('tr').querySelector('.tit a').textContent.trim()}
                                </span>
                                <span style="font-size: 11px; color: #666; margin-left: 10px;">进度: ${course.progress}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div style="font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 10px;">
                    <div>上一页按钮：<span style="color: ${hasPrevPage ? '#4CAF50' : '#f44336'}; font-weight: bold;">${hasPrevPage ? '已找到' : '未找到'}</span></div>
                    <div>下一页按钮：<span style="color: ${hasNextPage ? '#4CAF50' : '#f44336'}; font-weight: bold;">${hasNextPage ? '已找到' : '未找到'}</span></div>
                    <div style="margin-top: 5px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <button id="test-prev-btn" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 11px;">测试上一页</button>
                        <button id="test-next-btn" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 11px;">测试下一页</button>
                        <span style="flex-basis: 100%; margin-top: 5px;">提示：当前页面课程完成后${hasNextPage ? '将自动翻页' : '无下一页'}</span>
                    </div>
                </div>
            </div>
        `;
        
        // 添加到页面
        document.body.appendChild(appState.floatingWindow);
        
        // 绑定事件
        bindFloatingWindowEvents();
        
        // 开始倒计时
        startCountdown();
        
        // 添加拖拽功能
        const header = appState.floatingWindow.querySelector('div[style*="background: #4CAF50"]');
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        
        // 拖拽事件处理函数
        const handleMouseDown = (e) => {
            isDragging = true;
            startX = e.clientX - appState.floatingWindow.offsetLeft;
            startY = e.clientY - appState.floatingWindow.offsetTop;
            header.style.cursor = 'grabbing';
        };
        
        const handleMouseMove = (e) => {
            if (!isDragging) return;
            
            const x = e.clientX - startX;
            const y = e.clientY - startY;
            
            // 限制悬浮窗在可视区域内
            const maxX = window.innerWidth - appState.floatingWindow.offsetWidth;
            const maxY = window.innerHeight - appState.floatingWindow.offsetHeight;
            const finalX = Math.max(0, Math.min(x, maxX));
            const finalY = Math.max(0, Math.min(y, maxY));
            
            appState.floatingWindow.style.left = finalX + 'px';
            appState.floatingWindow.style.top = finalY + 'px';
        };
        
        const handleMouseUp = () => {
            isDragging = false;
            header.style.cursor = 'grab';
        };
        
        // 添加事件监听器
        header.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        // 保存拖拽事件处理函数
        appState.floatingWindowDragHandlers = {
            header: header,
            handleMouseDown: handleMouseDown,
            handleMouseMove: handleMouseMove,
            handleMouseUp: handleMouseUp
        };
        
        // 使用MutationObserver监听悬浮窗是否被移除
        // 优化：只观察漂浮窗口的父元素，缩小观察范围
        appState.floatingWindowObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                for (const node of mutation.removedNodes) {
                    if (node === appState.floatingWindow) {
                        // 移除事件监听器
                        removeFloatingWindowDragHandlers();
                        // 停止观察
                        appState.floatingWindowObserver.disconnect();
                        appState.floatingWindowObserver = null;
                        break;
                    }
                }
            });
        });
        
        // 开始观察，只观察漂浮窗口的父元素
        const parentElement = appState.floatingWindow.parentElement || document.body;
        appState.floatingWindowObserver.observe(parentElement, {
            childList: true,
            subtree: false // 不观察子树，只观察直接子节点
        });
    }
    
    /**
     * 移除漂浮窗口的拖拽事件处理函数
     */
    function removeFloatingWindowDragHandlers() {
        if (appState.floatingWindowDragHandlers) {
            const { header, handleMouseDown, handleMouseMove, handleMouseUp } = appState.floatingWindowDragHandlers;
            header.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            appState.floatingWindowDragHandlers = null;
        }
    }
    
    /**
     * 移除漂浮窗口并清理资源
     */
    function removeFloatingWindow() {
        // 清除倒计时定时器
        if (appState.countdownTimer) {
            clearInterval(appState.countdownTimer);
            appState.countdownTimer = null;
        }
        
        // 移除拖拽事件处理函数
        removeFloatingWindowDragHandlers();
        
        // 停止MutationObserver
        if (appState.floatingWindowObserver) {
            appState.floatingWindowObserver.disconnect();
            appState.floatingWindowObserver = null;
        }
        
        // 移除漂浮窗口元素
        if (appState.floatingWindow) {
            appState.floatingWindow.remove();
            appState.floatingWindow = null;
        }
    }
    
    /**
     * 绑定漂浮窗口事件
     */
    function bindFloatingWindowEvents() {
        // 使用事件委托，将所有事件监听器绑定到漂浮窗口上
        appState.floatingWindow.addEventListener('click', (e) => {
            const target = e.target;
            
            // 关闭按钮
            if (target.id === 'close-btn') {
                removeFloatingWindow();
            }
            
            // 折叠/展开按钮
            else if (target.id === 'collapse-btn') {
                const content = document.getElementById('window-content');
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    target.textContent = '折叠';
                } else {
                    content.style.display = 'none';
                    target.textContent = '展开';
                }
            }
            
            // 暂停按钮
            else if (target.id === 'pause-btn') {
                appState.isPaused = true;
                if (appState.countdownTimer) {
                    clearInterval(appState.countdownTimer);
                    appState.countdownTimer = null;
                }
            }
            
            // 开始按钮
            else if (target.id === 'play-btn') {
                if (appState.isPaused) {
                    appState.isPaused = false;
                    startCountdown();
                }
            }
            
            // 播放选中
            else if (target.id === 'play-selected') {
                playSelectedCourses();
            }
            
            // 播放全部
            else if (target.id === 'play-all') {
                playAllCourses();
            }
            
            // 测试上一页按钮
            else if (target.id === 'test-prev-btn') {
                testPrevPageBtn();
            }
            
            // 测试下一页按钮
            else if (target.id === 'test-next-btn') {
                testNextPageBtn();
            }
        });
        
        // 全选/取消全选 - 单独处理，因为是change事件
        appState.floatingWindow.addEventListener('change', (e) => {
            const target = e.target;
            if (target.id === 'select-all') {
                const checkboxes = appState.floatingWindow.querySelectorAll('.course-checkbox');
                checkboxes.forEach(checkbox => {
                    checkbox.checked = target.checked;
                });
            }
        });
    }
    
    /**
     * 测试上一页按钮
     */
    function testPrevPageBtn() {
        originalConsoleLog('测试上一页按钮...');
        
        // 查找上一页按钮
        const prevPageBtn = document.querySelector('.prev.ng-binding');
        if (!prevPageBtn) {
            originalConsoleLog('未找到上一页按钮，无法测试');
            alert('未找到上一页按钮，无法测试');
            return;
        }
        
        // 点击上一页按钮
        originalConsoleLog('点击上一页按钮进行测试');
        prevPageBtn.click();
        
        // 关闭当前漂浮窗口
        removeFloatingWindow();
        
        // 重置全局变量，重新初始化脚本
        setTimeout(() => {
            originalConsoleLog('上一页测试完成，重新初始化脚本...');
            // 重置全局变量
            Object.assign(appState, {
                courseQueue: [],
                selectedCourses: [],
                currentCourse: null,
                currentWindow: null,
                checkTimer: null,
                startTime: 0,
                messageReceived: false,
                lastProcessTime: 0,
                isConsoleOverridden: false,
                isMessageListenerAdded: false,
                countdown: 10,
                isPaused: false
            });
            
            // 重新初始化
            setupListPage();
        }, config.pageLoadDelay);
    }
    
    /**
     * 测试下一页按钮
     */
    function testNextPageBtn() {
        originalConsoleLog('测试下一页按钮...');
        
        // 查找下一页按钮
        const nextPageBtn = document.querySelector('.next.ng-binding');
        if (!nextPageBtn) {
            originalConsoleLog('未找到下一页按钮，无法测试');
            alert('未找到下一页按钮，无法测试');
            return;
        }
        
        // 点击下一页按钮
        originalConsoleLog('点击下一页按钮进行测试');
        nextPageBtn.click();
        
        // 关闭当前漂浮窗口
        removeFloatingWindow();
        
        // 重置全局变量，重新初始化脚本
        setTimeout(() => {
            originalConsoleLog('下一页测试完成，重新初始化脚本...');
            // 重置全局变量
            Object.assign(appState, {
                courseQueue: [],
                selectedCourses: [],
                currentCourse: null,
                currentWindow: null,
                checkTimer: null,
                startTime: 0,
                messageReceived: false,
                lastProcessTime: 0,
                isConsoleOverridden: false,
                isMessageListenerAdded: false,
                countdown: 10,
                isPaused: false
            });
            
            // 重新初始化
            setupListPage();
        }, config.pageLoadDelay);
    }
    
    /**
     * 开始倒计时
     */
    function startCountdown() {
        appState.countdownTimer = setInterval(() => {
            if (appState.isPaused) return;
            
            appState.countdown--;
            document.getElementById('countdown').textContent = appState.countdown;
            
            if (appState.countdown <= 0) {
                clearInterval(appState.countdownTimer);
                appState.countdownTimer = null;
                playAllCourses();
            }
        }, 1000);
    }
    
    /**
     * 播放选中的课程
     */
    function playSelectedCourses() {
        // 收集选中的课程
        appState.selectedCourses = [];
        // 优化：使用更高效的方式收集选中的课程
        // 缩小查询范围，只在漂浮窗口内查询
        const checkboxes = appState.floatingWindow.querySelectorAll('.course-checkbox');
        // 使用for循环替代forEach，提高性能
        for (let i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) {
                appState.selectedCourses.push(appState.courseQueue[i]);
            }
        }
        
        if (appState.selectedCourses.length === 0) {
            originalConsoleLog('请至少选择一个课程');
            return;
        }
        
        // 使用选中的课程作为新的队列
        appState.courseQueue = [...appState.selectedCourses];
        startProcessing();
    }
    
    /**
     * 播放全部课程
     */
    function playAllCourses() {
        appState.selectedCourses = [...appState.courseQueue];
        startProcessing();
    }
    
    /**
     * 开始处理课程
     */
    function startProcessing() {
        // 清除倒计时
        if (appState.countdownTimer) {
            clearInterval(appState.countdownTimer);
            appState.countdownTimer = null;
        }
        
        // 开始处理课程
        processNextCourse();
    }
    
    /**
     * 设置列表页面的处理逻辑
     */
    function setupListPage() {
        // 添加重试计数
        let retryCount = 0;
        const maxRetries = 10;
        const retryInterval = 1000; // 1秒重试一次
        
        // 缓存选择器，避免重复定义
        const tabBdSelectors = ['.tab-bd', '[ng-show*="notPass"]', '.tab-bd[ng-show]'];
        const tableSelectors = ['.ui-table.class-table', '.ui-table', 'table'];
        
        function trySetup() {
            retryCount++;
            
            // 尝试多种选择器获取目标div元素
            let tabBd = null;
            for (const selector of tabBdSelectors) {
                tabBd = document.querySelector(selector);
                if (tabBd) break;
            }
            
            if (!tabBd) {
                if (retryCount < maxRetries) {
                    setTimeout(trySetup, retryInterval);
                }
                return;
            }

            // 尝试多种选择器获取table元素
            let table = null;
            for (const selector of tableSelectors) {
                table = tabBd.querySelector(selector);
                if (table) break;
            }
            
            if (!table) {
                if (retryCount < maxRetries) {
                    setTimeout(trySetup, retryInterval);
                }
                return;
            }
            
            // 收集未完成课程
            const allCompleted = collectUnfinishedCourses(table);
            
            // 如果有未完成课程，显示漂浮窗口
            if (appState.courseQueue.length > 0) {
                createFloatingWindow();
            } else if (allCompleted) {
                // 当前页面所有课程都是100%，尝试翻页
                checkAndTurnPage();
            }
        }
        
        trySetup();
    }

    /**
     * 设置播放页面的监听
     */
    function setupPlayPageListener() {
        originalConsoleLog('设置播放页面监听...');
        
        if (appState.isConsoleOverridden) {
            originalConsoleLog('console.log已被重写，跳过设置');
            return;
        }
        
        // 初始化播放页面相关资源
        appState.playPageResources = {
            hasNextSection: false,
            hasNextButton: false,
            playCompleteTimeout: null,
            playCheckTimer: null
        };
        
        // 发送播放完成消息
        function sendPlayCompleteMessage() {
            originalConsoleLog('发送播放完成消息...');
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'COURSE_PLAY_COMPLETE' }, '*');
            }
            if (window.opener) {
                window.opener.postMessage({ type: 'COURSE_PLAY_COMPLETE' }, '*');
            }
        }
        
        // 检测下一个按钮是否存在
        function checkNextButton() {
            const nextButton = document.querySelector('.next.ng-scope');
            appState.playPageResources.hasNextButton = !!nextButton;
            return appState.playPageResources.hasNextButton;
        }
        
        // 播放完成处理逻辑
        function handlePlayCompleteLogic(source, timer = null) {
            // 多次检测下一个按钮，确保准确判断
            let nextButtonExists = false;
            for (let i = 0; i < 3; i++) {
                if (checkNextButton()) {
                    nextButtonExists = true;
                    break;
                }
            }
            
            // 检测视频播放状态
            const video = document.querySelector('video');
            // 如果没有video元素，或者视频已播放到最后1秒，认为视频已播放完成
            const isVideoComplete = !video || (video.readyState >= 3 && video.currentTime >= video.duration - 1);
            
            // 只有在没有下一节且没有下一个按钮时，才执行播放完成的后续动作
            // 当没有video元素时，认为视频已播放完成
            if (!appState.playPageResources.hasNextSection && !nextButtonExists) {
                originalConsoleLog(`${source}10秒内未检测到"点击下一节"关键词且没有下一个按钮且视频已播放完成，发送播放完成消息`);
                if (timer) clearInterval(timer);
                sendPlayCompleteMessage();
                originalConsoleLog('播放完成，3秒后关闭窗口...');
                setTimeout(() => window.close(), 3000);
            } else {
                originalConsoleLog(`${source}10秒内${appState.playPageResources.hasNextSection ? '检测到"点击下一节"关键词' : ''}${appState.playPageResources.hasNextSection && nextButtonExists ? '且' : ''}${nextButtonExists ? '存在下一个按钮' : ''}，继续播放`);
                appState.playPageResources.hasNextSection = false;
            }
            appState.playPageResources.playCompleteTimeout = null;
        }
        
        // 重写console.log，检测播放完成提示
        console.log = function(...args) {
            const logText = args.join(' ');
            originalConsoleLog.apply(console, args);
            
            // 检测是否包含"点击下一节"关键词
            if (logText.includes('点击下一节')) {
                originalConsoleLog('播放页面检测到"点击下一节"关键词，取消播放完成处理');
                appState.playPageResources.hasNextSection = true;
                if (appState.playPageResources.playCompleteTimeout) {
                    clearTimeout(appState.playPageResources.playCompleteTimeout);
                    appState.playPageResources.playCompleteTimeout = null;
                }
            }
            
            // 检测是否包含播放完成关键词
            if (isPlayComplete(logText)) {
                originalConsoleLog('播放页面检测到播放完成提示');
                
                // 设置30秒延迟，等待可能出现的"点击下一节"关键词
                if (appState.playPageResources.playCompleteTimeout) {
                    clearTimeout(appState.playPageResources.playCompleteTimeout);
                }
                appState.playPageResources.playCompleteTimeout = setTimeout(() => handlePlayCompleteLogic('播放页面'), 30000);
            }
        };
        
        appState.isConsoleOverridden = true;
        
        // 定时器检测，防止console.log没有触发
        // 优化：使用更合理的间隔，减少不必要的检测
        appState.playPageResources.playCheckTimer = setInterval(() => {
            checkNextButton();
            
            // 检查是否有播放完成的DOM元素
            const completeElement = document.querySelector('.play-complete, .course-finished');
            if (completeElement) {
                originalConsoleLog('通过DOM元素检测到播放完成');
                
                // 设置30秒延迟，等待可能出现的"点击下一节"关键词
                if (appState.playPageResources.playCompleteTimeout) {
                    clearTimeout(appState.playPageResources.playCompleteTimeout);
                }
                appState.playPageResources.playCompleteTimeout = setTimeout(() => handlePlayCompleteLogic('', appState.playPageResources.playCheckTimer), 30000);
            }
        }, Math.max(config.checkInterval, 5000)); // 至少5秒检测一次，减少CPU占用
        
        // 监听窗口关闭事件
        window.addEventListener('beforeunload', () => {
            checkNextButton();
            
            // 只有在真正完成播放时才发送消息
            if (appState.playPageResources.playCompleteTimeout === null && 
                !appState.playPageResources.hasNextSection && 
                !appState.playPageResources.hasNextButton) {
                const video = document.querySelector('video');
                const isVideoComplete = !video || (video.readyState >= 4 && video.currentTime >= video.duration - 1);
                
                if (isVideoComplete) {
                    originalConsoleLog('窗口即将关闭，视频已播放完成，发送播放完成消息...');
                    sendPlayCompleteMessage();
                }
            }
        });
        
        originalConsoleLog('播放页面监听设置完成');
    }

    /**
     * 收集未完成课程
     * @param {HTMLElement} table - 课程表格元素
     * @returns {boolean} - 当前页面是否所有课程都是100%
     */
    function collectUnfinishedCourses(table) {
        // 获取所有课程行
        const courseRows = table.querySelectorAll('tbody tr');
        // 清空队列，避免重复添加
        appState.courseQueue = [];

        // 遍历每个课程行
        courseRows.forEach((row, index) => {
            // 优化：使用更高效的方法查找进度span
            let progressSpan = null;
            const spans = row.querySelectorAll('span');
            for (let i = 0; i < spans.length; i++) {
                if (spans[i].textContent.includes('课程进度')) {
                    progressSpan = spans[i];
                    break;
                }
            }

            if (!progressSpan) return;

            // 获取进度百分比
            const progressLabel = progressSpan.querySelector('label');
            if (!progressLabel) return;

            const progressText = progressLabel.textContent.trim();

            // 判断进度是否为100%
            if (progressText !== '100%') {
                // 优化：使用更高效的方法查找学习按钮
                let learnBtn = null;
                const btns = row.querySelectorAll('a.btn');
                for (let i = 0; i < btns.length; i++) {
                    if (btns[i].textContent.includes('学习课程')) {
                        learnBtn = btns[i];
                        break;
                    }
                }

                if (learnBtn) {
                    // 将课程信息添加到队列
                    appState.courseQueue.push({
                        row: row,
                        learnBtn: learnBtn,
                        progress: progressText,
                        index: index + 1
                    });
                }
            }
        });
        
        // 检测当前页面是否所有课程都是100%
        return courseRows.length > 0 && appState.courseQueue.length === 0;
    }

    /**
     * 已移除setupConsoleListener函数，因为它无法检测到播放页面的console.log输出
     * 列表页面和播放页面是两个独立窗口，它们的console.log对象完全独立
     * 现在只依赖播放页面发送的COURSE_PLAY_COMPLETE消息
     */
    
    /**
     * 检查并执行翻页
     */
    function checkAndTurnPage() {
        originalConsoleLog('当前页面所有课程已完成，尝试翻页...');
        
        // 查找下一页按钮
        const nextPageBtn = document.querySelector('.next.ng-binding');
        if (!nextPageBtn) {
            originalConsoleLog('未找到下一页按钮');
            return false;
        }
        
        // 点击下一页
        originalConsoleLog('点击下一页按钮');
        nextPageBtn.click();
        
        // 翻页后重新初始化脚本
        setTimeout(() => {
            originalConsoleLog('翻页完成，重新初始化脚本...');
            // 重置全局变量
            Object.assign(appState, {
                courseQueue: [],
                selectedCourses: [],
                currentCourse: null,
                currentWindow: null,
                checkTimer: null,
                startTime: 0,
                messageReceived: false,
                lastProcessTime: 0,
                isConsoleOverridden: false,
                isMessageListenerAdded: false,
                countdown: 10,
                isPaused: false
            });
            
            // 重新初始化
            setupListPage();
        }, config.pageLoadDelay);
        
        return true;
    }

    /**
     * 检测是否包含播放完成关键词
     * @param {string} text - 日志文本
     * @returns {boolean} - 是否包含播放完成关键词
     */
    function isPlayComplete(text) {
        return config.playCompleteKeywords.some(keyword => 
            text.includes(keyword)
        );
    }

    /**
     * 处理播放完成事件
     */
    function handlePlayComplete() {
        // 使用原始console.log输出，避免循环调用
        originalConsoleLog('处理播放完成事件');
        
        // 清除检测定时器
        if (appState.checkTimer) {
            clearInterval(appState.checkTimer);
            appState.checkTimer = null;
        }
        
        // 关闭当前窗口（如果存在）
        if (appState.currentWindow && !appState.currentWindow.closed) {
            try {
                appState.currentWindow.close();
                originalConsoleLog('已关闭当前课程窗口');
            } catch (e) {
                originalConsoleLog('关闭窗口失败，可能是跨域限制:', e.message);
            }
        }
        
        // 重置当前课程信息
        appState.currentCourse = null;
        appState.currentWindow = null;
        
        // 重置消息接收标记，以便处理下一个消息
        appState.messageReceived = false;
        
        // 播放完成后等待2秒提示，然后刷新页面，防止页面卡死
        originalConsoleLog('当前课程播放完成，2秒后刷新页面...');
        setTimeout(() => {
            // 保存当前的课程队列到localStorage
            if (appState.courseQueue.length > 0) {
                localStorage.setItem('courseQueue', JSON.stringify(appState.courseQueue));
                originalConsoleLog('已保存课程队列到localStorage，准备刷新页面...');
            }
            // 刷新页面
            location.reload();
        }, 2000);
    }

    /**
     * 处理下一个课程
     */
    function processNextCourse() {
        // 如果队列为空，结束处理
        if (appState.courseQueue.length === 0) {
            // 恢复原始console.log
            if (appState.isConsoleOverridden) {
                console.log = originalConsoleLog;
                appState.isConsoleOverridden = false;
            }
            // 移除消息事件监听器
            if (appState.isMessageListenerAdded) {
                window.removeEventListener('message', handleMessageEvent);
                appState.isMessageListenerAdded = false;
            }
            return;
        }
        
        // 获取下一个课程
        appState.currentCourse = appState.courseQueue.shift();
        
        // 输出基本提示
        originalConsoleLog(`开始播放第${appState.currentCourse.index}个课程，进度：${appState.currentCourse.progress}`);
        
        // 记录开始时间
        appState.startTime = Date.now();
        
        // 添加消息事件监听器，接收来自播放页面的消息（防止重复添加）
        if (!appState.isMessageListenerAdded) {
            window.addEventListener('message', handleMessageEvent);
            appState.isMessageListenerAdded = true;
        }
        
        // 模拟点击学习课程按钮，打开新窗口
        try {
            // 先尝试直接点击
            appState.currentCourse.learnBtn.click();
            
            // 开始检测播放完成
            startCheckPlayComplete();
        } catch (e) {
            // 继续处理下一个课程
            setTimeout(processNextCourse, config.pageLoadDelay);
        }
    }

    /**
     * 处理消息事件，接收来自播放页面的通知
     * @param {Event} event - 消息事件
     */
    function handleMessageEvent(event) {
        // 检查是否在列表页面
        if (!isListPage()) {
            return;
        }
        
        // 检查消息类型
        if (event.data && event.data.type === 'COURSE_PLAY_COMPLETE') {
            // 检查是否已经处理过该消息
            if (appState.messageReceived) {
                originalConsoleLog('消息已处理，忽略重复消息');
                return;
            }
            
            // 检查处理频率，至少间隔5秒
            const now = Date.now();
            if (now - appState.lastProcessTime < 5000) {
                originalConsoleLog('处理频率过高，忽略消息');
                return;
            }
            
            originalConsoleLog('收到播放完成消息，准备处理下一个课程');
            
            // 设置消息已处理标记
            appState.messageReceived = true;
            appState.lastProcessTime = now;
            
            // 处理下一个课程，添加5秒延迟检查，与setupConsoleListener保持一致
            // 注意：这里我们无法直接访问setupConsoleListener中的hasNextSection变量
            // 所以我们需要依赖播放页面的逻辑，确保只有在真正完成时才发送消息
            // 这里我们添加一个短延迟，确保播放页面的console.log有足够时间处理
            setTimeout(() => {
                originalConsoleLog('消息处理延迟结束，执行播放完成处理');
                handlePlayComplete();
            }, 1000);
        }
    }

    /**
     * 开始检测播放完成
     */
    function startCheckPlayComplete() {
        // 设置定时器，定期检测（5分钟更新一次）
        appState.checkTimer = setInterval(() => {
            // 检查是否超过最大等待时间
            if (Date.now() - appState.startTime > config.maxWaitTime) {
                handlePlayComplete();
                return;
            }
            
            // 这里可以添加其他检测逻辑，比如检查当前窗口状态
            // 由于浏览器安全限制，可能无法直接访问跨域窗口的内容
            
        }, 300000); // 5分钟更新一次
    }

    /**
     * 获取课程URL（根据页面具体情况实现）
     * @param {HTMLElement} row - 课程行元素
     * @returns {string|null} - 课程URL
     */
    function getCourseUrl(row) {
        // 这里需要根据页面具体情况实现，比如从data属性或点击事件中提取URL
        // 示例：const link = row.querySelector('a[data-url]');
        // return link ? link.dataset.url : null;
        return null;
    }

    // 资源清理函数
    function cleanup() {
        // 清除所有定时器
        if (appState.countdownTimer) {
            clearInterval(appState.countdownTimer);
            appState.countdownTimer = null;
        }
        if (appState.checkTimer) {
            clearInterval(appState.checkTimer);
            appState.checkTimer = null;
        }
        
        // 清除播放页面资源
        if (appState.playPageResources) {
            if (appState.playPageResources.playCompleteTimeout) {
                clearTimeout(appState.playPageResources.playCompleteTimeout);
                appState.playPageResources.playCompleteTimeout = null;
            }
            if (appState.playPageResources.playCheckTimer) {
                clearInterval(appState.playPageResources.playCheckTimer);
                appState.playPageResources.playCheckTimer = null;
            }
            // 清理播放页面资源对象
            appState.playPageResources = null;
        }
        
        // 移除漂浮窗口
        removeFloatingWindow();
        
        // 移除事件监听器
        if (appState.isMessageListenerAdded) {
            window.removeEventListener('message', handleMessageEvent);
            appState.isMessageListenerAdded = false;
        }
        
        // 恢复原始console.log
        if (appState.isConsoleOverridden) {
            console.log = originalConsoleLog;
            appState.isConsoleOverridden = false;
        }
        
        // 关闭当前窗口（如果存在）
        if (appState.currentWindow && !appState.currentWindow.closed) {
            try {
                appState.currentWindow.close();
            } catch (e) {
                // 忽略关闭失败的错误
            }
        }
        
        // 清除localStorage中的课程队列
        localStorage.removeItem('courseQueue');
    }
    
    // 在页面卸载时清理资源
    window.addEventListener('beforeunload', cleanup);
    
    // 启动脚本
    initScript();

})();