// ==UserScript==
// @name         自动播放未完成课程（串行处理）
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  串行处理未完成课程，监听播放完成事件，一次只打开一个页面
// @author       You
// @match        *://*/*
// @grant        none
// @updateURL    https://github.com/toughgj/hnskjry/blob/main/scriptcat_course_auto_click.user.js
// @downloadURL  https://github.com/toughgj/hnskjry/blob/main/scriptcat_course_auto_click.user.js
// @homepage     https://github.com/toughgj/hnskjry
// ==/UserScript==

(function() {
    'use strict';

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

    // 全局变量
    let courseQueue = []; // 未完成课程队列
    let selectedCourses = []; // 用户选择的课程
    let currentCourse = null; // 当前处理的课程
    let currentWindow = null; // 当前打开的窗口
    let checkTimer = null; // 检测播放完成的定时器
    let startTime = 0; // 当前课程开始处理的时间
    let originalConsoleLog = console.log; // 保存原始console.log
    let messageReceived = false; // 消息接收标记，防止重复处理
    let lastProcessTime = 0; // 上次处理时间，用于控制刷新频率
    let isConsoleOverridden = false; // 标记console.log是否已被重写
    let isMessageListenerAdded = false; // 标记消息监听器是否已添加
    let floatingWindow = null; // 漂浮窗口元素
    let countdownTimer = null; // 倒计时定时器
    let countdown = 10; // 倒计时秒数
    let isPaused = false; // 是否暂停

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
                    courseQueue = JSON.parse(savedQueue);
                    originalConsoleLog(`从localStorage中恢复了${courseQueue.length}个未完成课程`);
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
        // 如果已经存在漂浮窗口，先移除
        if (floatingWindow) {
            floatingWindow.remove();
        }
        
        // 查找上一页和下一页按钮，检查是否存在
        const hasPrevPage = !!document.querySelector('.prev.ng-binding');
        const hasNextPage = !!document.querySelector('.next.ng-binding');
        
        // 创建漂浮窗口元素
        floatingWindow = document.createElement('div');
        floatingWindow.id = 'scriptcat-floating-window';
        
        // 设置CSS样式
        floatingWindow.style.cssText = `
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
            padding: 15px;
            color: #333;
        `;
        
        // 构建HTML结构
        floatingWindow.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="margin: 0; color: #4CAF50;">自动播放控制</h3>
                <button id="close-btn" style="background: #f44336; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer;">关闭</button>
            </div>
            
            <div style="margin-bottom: 15px;">
                <div style="font-size: 14px; margin-bottom: 5px;">倒计时：<span id="countdown" style="font-size: 24px; font-weight: bold; color: #4CAF50;">${countdown}</span>秒</div>
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
                
                <div id="course-list" style="max-height: 200px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 10px; background: #f9f9f9;">
                    ${courseQueue.map((course, index) => `
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
        `;
        
        // 添加到页面
        document.body.appendChild(floatingWindow);
        
        // 绑定事件
        bindFloatingWindowEvents();
        
        // 开始倒计时
        startCountdown();
    }
    
    /**
     * 绑定漂浮窗口事件
     */
    function bindFloatingWindowEvents() {
        // 关闭按钮
        document.getElementById('close-btn').addEventListener('click', () => {
            clearInterval(countdownTimer);
            floatingWindow.remove();
            floatingWindow = null;
        });
        
        // 暂停按钮
        document.getElementById('pause-btn').addEventListener('click', () => {
            isPaused = true;
            clearInterval(countdownTimer);
        });
        
        // 开始按钮
        document.getElementById('play-btn').addEventListener('click', () => {
            if (isPaused) {
                isPaused = false;
                startCountdown();
            }
        });
        
        // 全选/取消全选
        document.getElementById('select-all').addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.course-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = e.target.checked;
            });
        });
        
        // 播放选中
        document.getElementById('play-selected').addEventListener('click', () => {
            playSelectedCourses();
        });
        
        // 播放全部
        document.getElementById('play-all').addEventListener('click', () => {
            playAllCourses();
        });
        
        // 测试上一页按钮
        document.getElementById('test-prev-btn').addEventListener('click', () => {
            testPrevPageBtn();
        });
        
        // 测试下一页按钮
        document.getElementById('test-next-btn').addEventListener('click', () => {
            testNextPageBtn();
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
        if (floatingWindow) {
            clearInterval(countdownTimer);
            floatingWindow.remove();
            floatingWindow = null;
        }
        
        // 重置全局变量，重新初始化脚本
        setTimeout(() => {
            originalConsoleLog('上一页测试完成，重新初始化脚本...');
            // 重置全局变量
            courseQueue = [];
            selectedCourses = [];
            currentCourse = null;
            currentWindow = null;
            checkTimer = null;
            startTime = 0;
            messageReceived = false;
            lastProcessTime = 0;
            isConsoleOverridden = false;
            isMessageListenerAdded = false;
            countdown = 10;
            isPaused = false;
            
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
        if (floatingWindow) {
            clearInterval(countdownTimer);
            floatingWindow.remove();
            floatingWindow = null;
        }
        
        // 重置全局变量，重新初始化脚本
        setTimeout(() => {
            originalConsoleLog('下一页测试完成，重新初始化脚本...');
            // 重置全局变量
            courseQueue = [];
            selectedCourses = [];
            currentCourse = null;
            currentWindow = null;
            checkTimer = null;
            startTime = 0;
            messageReceived = false;
            lastProcessTime = 0;
            isConsoleOverridden = false;
            isMessageListenerAdded = false;
            countdown = 10;
            isPaused = false;
            
            // 重新初始化
            setupListPage();
        }, config.pageLoadDelay);
    }
    
    /**
     * 开始倒计时
     */
    function startCountdown() {
        countdownTimer = setInterval(() => {
            if (isPaused) return;
            
            countdown--;
            document.getElementById('countdown').textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(countdownTimer);
                playAllCourses();
            }
        }, 1000);
    }
    
    /**
     * 播放选中的课程
     */
    function playSelectedCourses() {
        // 收集选中的课程
        selectedCourses = [];
        const checkboxes = document.querySelectorAll('.course-checkbox');
        checkboxes.forEach((checkbox, index) => {
            if (checkbox.checked) {
                selectedCourses.push(courseQueue[index]);
            }
        });
        
        if (selectedCourses.length === 0) {
            originalConsoleLog('请至少选择一个课程');
            return;
        }
        
        // 使用选中的课程作为新的队列
        courseQueue = [...selectedCourses];
        startProcessing();
    }
    
    /**
     * 播放全部课程
     */
    function playAllCourses() {
        selectedCourses = [...courseQueue];
        startProcessing();
    }
    
    /**
     * 开始处理课程
     */
    function startProcessing() {
        // 关闭漂浮窗口
        if (floatingWindow) {
            floatingWindow.remove();
            floatingWindow = null;
        }
        
        // 清除倒计时
        clearInterval(countdownTimer);
        
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
        
        function trySetup() {
            retryCount++;
            
            // 尝试多种选择器获取目标div元素
            const tabBd = document.querySelector('.tab-bd') || 
                         document.querySelector('[ng-show*="notPass"]') ||
                         document.querySelector('.tab-bd[ng-show]');
            
            if (!tabBd) {
                if (retryCount < maxRetries) {
                    setTimeout(trySetup, retryInterval);
                }
                return;
            }

            // 尝试多种选择器获取table元素
            const table = tabBd.querySelector('.ui-table.class-table') || 
                         tabBd.querySelector('.ui-table') ||
                         tabBd.querySelector('table');
            
            if (!table) {
                if (retryCount < maxRetries) {
                    setTimeout(trySetup, retryInterval);
                }
                return;
            }
            
            // 收集未完成课程
            const allCompleted = collectUnfinishedCourses(table);
            
            // 如果有未完成课程，显示漂浮窗口
            if (courseQueue.length > 0) {
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
        if (isConsoleOverridden) {
            return;
        }
        
        // 标志变量
        let hasNextSection = false;
        let hasNextButton = false;
        let playCompleteTimeout = null;
        let playCheckTimer = null;
        
        // 发送播放完成消息
        function sendPlayCompleteMessage() {
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
            hasNextButton = !!nextButton;
            return hasNextButton;
        }
        
        // 播放完成处理逻辑
        function handlePlayCompleteLogic() {
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
            const isVideoComplete = !video || (video.readyState >= 3 && video.currentTime >= video.duration - 1);
            
            // 只有在没有下一节且视频已播放完成时，才执行播放完成的后续动作
            if (!hasNextSection && !nextButtonExists && isVideoComplete) {
                // 清除定时器
                if (playCheckTimer) {
                    clearInterval(playCheckTimer);
                    playCheckTimer = null;
                }
                sendPlayCompleteMessage();
                setTimeout(() => window.close(), 3000);
            } else {
                hasNextSection = false;
            }
            playCompleteTimeout = null;
        }
        
        // 重写console.log，检测播放完成提示
        console.log = function(...args) {
            const logText = args.join(' ');
            originalConsoleLog.apply(console, args);
            
            // 检测是否包含"点击下一节"关键词
            if (logText.includes('点击下一节')) {
                hasNextSection = true;
                if (playCompleteTimeout) {
                    clearTimeout(playCompleteTimeout);
                    playCompleteTimeout = null;
                }
            }
            
            // 检测是否包含播放完成关键词
            if (isPlayComplete(logText)) {
                // 设置10秒延迟，等待可能出现的"点击下一节"关键词
                if (playCompleteTimeout) clearTimeout(playCompleteTimeout);
                playCompleteTimeout = setTimeout(handlePlayCompleteLogic, 10000);
            }
        };
        
        isConsoleOverridden = true;
        
        // 定时器检测，防止console.log没有触发
        playCheckTimer = setInterval(() => {
            checkNextButton();
            
            // 检查是否有播放完成的DOM元素
            const completeElement = document.querySelector('.play-complete, .course-finished');
            if (completeElement) {
                // 设置10秒延迟，等待可能出现的"点击下一节"关键词
                if (playCompleteTimeout) clearTimeout(playCompleteTimeout);
                playCompleteTimeout = setTimeout(handlePlayCompleteLogic, 10000);
            }
        }, config.checkInterval);
    }

    /**
     * 收集未完成课程
     * @param {HTMLElement} table - 课程表格元素
     * @returns {boolean} - 当前页面是否所有课程都是100%
     */
    function collectUnfinishedCourses(table) {
        // 获取所有课程行
        const courseRows = table.querySelectorAll('tbody tr');

        // 遍历每个课程行
        courseRows.forEach((row, index) => {
            // 获取所有span元素，查找包含"课程进度"的span
            const spans = row.querySelectorAll('span');
            let progressSpan = null;
            for (const span of spans) {
                if (span.textContent.includes('课程进度')) {
                    progressSpan = span;
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
                // 获取所有a.btn元素，查找包含"学习课程"的按钮
                const btns = row.querySelectorAll('a.btn');
                let learnBtn = null;
                for (const btn of btns) {
                    if (btn.textContent.includes('学习课程')) {
                        learnBtn = btn;
                        break;
                    }
                }

                if (learnBtn) {
                    // 将课程信息添加到队列
                    courseQueue.push({
                        row: row,
                        learnBtn: learnBtn,
                        progress: progressText,
                        index: index + 1
                    });
                }
            }
        });
        
        // 检测当前页面是否所有课程都是100%
        return courseRows.length > 0 && courseQueue.length === 0;
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
            courseQueue = [];
            selectedCourses = [];
            currentCourse = null;
            currentWindow = null;
            checkTimer = null;
            startTime = 0;
            messageReceived = false;
            lastProcessTime = 0;
            isConsoleOverridden = false;
            isMessageListenerAdded = false;
            countdown = 10;
            isPaused = false;
            
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
        if (checkTimer) {
            clearInterval(checkTimer);
            checkTimer = null;
        }
        
        // 关闭当前窗口（如果存在）
        if (currentWindow && !currentWindow.closed) {
            try {
                currentWindow.close();
                originalConsoleLog('已关闭当前课程窗口');
            } catch (e) {
                originalConsoleLog('关闭窗口失败，可能是跨域限制:', e.message);
            }
        }
        
        // 重置当前课程信息
        currentCourse = null;
        currentWindow = null;
        
        // 重置消息接收标记，以便处理下一个消息
        messageReceived = false;
        
        // 播放完成后等待2秒提示，然后刷新页面，防止页面卡死
        originalConsoleLog('当前课程播放完成，2秒后刷新页面...');
        setTimeout(() => {
            // 保存当前的课程队列到localStorage
            if (courseQueue.length > 0) {
                localStorage.setItem('courseQueue', JSON.stringify(courseQueue));
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
        if (courseQueue.length === 0) {
            // 恢复原始console.log
            if (isConsoleOverridden) {
                console.log = originalConsoleLog;
                isConsoleOverridden = false;
            }
            // 移除消息事件监听器
            if (isMessageListenerAdded) {
                window.removeEventListener('message', handleMessageEvent);
                isMessageListenerAdded = false;
            }
            return;
        }
        
        // 获取下一个课程
        currentCourse = courseQueue.shift();
        
        // 输出基本提示
        originalConsoleLog(`开始播放第${currentCourse.index}个课程，进度：${currentCourse.progress}`);
        
        // 记录开始时间
        startTime = Date.now();
        
        // 添加消息事件监听器，接收来自播放页面的消息（防止重复添加）
        if (!isMessageListenerAdded) {
            window.addEventListener('message', handleMessageEvent);
            isMessageListenerAdded = true;
        }
        
        // 模拟点击学习课程按钮，打开新窗口
        try {
            // 先尝试直接点击
            currentCourse.learnBtn.click();
            
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
            if (messageReceived) {
                return;
            }
            
            // 检查处理频率，至少间隔5秒
            const now = Date.now();
            if (now - lastProcessTime < 5000) {
                return;
            }
            
            // 设置消息已处理标记
            messageReceived = true;
            lastProcessTime = now;
            
            // 处理下一个课程
            setTimeout(handlePlayComplete, 1000);
        }
    }

    /**
     * 开始检测播放完成
     */
    function startCheckPlayComplete() {
        // 设置定时器，定期检测（5分钟更新一次）
        checkTimer = setInterval(() => {
            // 检查是否超过最大等待时间
            if (Date.now() - startTime > config.maxWaitTime) {
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

    // 启动脚本
    initScript();

})();