// ==UserScript==
// @name         自动播放未完成课程（串行处理）
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  串行处理未完成课程，监听播放完成事件，一次只打开一个页面
// @author       You
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 配置参数
    const config = {
        // 播放完成的console提示关键词
        playCompleteKeywords: ['视频结束'],
        // 列表页面URL
        listPageUrl: 'https://zdkj.v.zzu.edu.cn/center',
        // 播放页面URL前缀
        playPagePrefix: 'https://zdkj.v.zzu.edu.cn/play',
        // 页面加载等待时间（毫秒）
        pageLoadDelay: 3000,
        // 检测播放完成的间隔时间（毫秒）
        checkInterval: 2000,
        // 最大等待时间（毫秒），防止单个课程卡住
        maxWaitTime: 3600000 // 1小时
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
        
        // 查找下一页按钮，检查是否存在
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
                <div>下一页按钮：<span style="color: ${hasNextPage ? '#4CAF50' : '#f44336'}; font-weight: bold;">${hasNextPage ? '已找到' : '未找到'}</span></div>
                <div style="margin-top: 5px; display: flex; align-items: center;">
                    <button id="test-next-btn" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 11px; margin-right: 10px;">测试下一页</button>
                    <span>提示：当前页面课程完成后${hasNextPage ? '将自动翻页' : '无下一页'}</span>
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
        
        // 测试下一页按钮
        document.getElementById('test-next-btn').addEventListener('click', () => {
            testNextPageBtn();
        });
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
            originalConsoleLog('翻页测试完成，重新初始化脚本...');
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
        originalConsoleLog(`共找到${courseQueue.length}个未完成课程，开始串行处理...`);
        setupConsoleListener();
        processNextCourse();
    }
    
    /**
     * 设置列表页面的处理逻辑
     */
    function setupListPage() {
        // 使用原始console.log输出，避免循环调用
        originalConsoleLog('设置列表页面处理逻辑...');
        
        // 尝试多种选择器获取目标div元素
        const tabBd = document.querySelector('.tab-bd') || 
                     document.querySelector('[ng-show*="notPass"]') ||
                     document.querySelector('.tab-bd[ng-show]');
        
        if (!tabBd) {
            originalConsoleLog('未找到目标div元素，500毫秒后重试...');
            setTimeout(setupListPage, 500);
            return;
        }

        originalConsoleLog('找到目标div元素:');
        
        // 尝试多种选择器获取table元素
        const table = tabBd.querySelector('.ui-table.class-table') || 
                     tabBd.querySelector('.ui-table') ||
                     tabBd.querySelector('table');
        
        if (!table) {
            originalConsoleLog('未找到目标table元素，500毫秒后重试...');
            setTimeout(setupListPage, 500);
            return;
        }
        
        originalConsoleLog('找到目标table元素:');
        
        // 收集未完成课程
        const allCompleted = collectUnfinishedCourses(table);
        
        // 如果有未完成课程，显示漂浮窗口
        if (courseQueue.length > 0) {
            originalConsoleLog(`共找到${courseQueue.length}个未完成课程，显示控制窗口...`);
            createFloatingWindow();
        } else if (allCompleted) {
            // 当前页面所有课程都是100%，尝试翻页
            checkAndTurnPage();
        } else {
            originalConsoleLog('所有课程已完成，无需处理');
        }
    }

    /**
     * 设置播放页面的监听
     */
    function setupPlayPageListener() {
        // 使用原始console.log输出，避免循环调用
        originalConsoleLog('设置播放页面监听...');
        
        // 防止重复重写console.log
        if (isConsoleOverridden) {
            originalConsoleLog('console.log已被重写，跳过设置');
            return;
        }
        
        // 发送播放完成消息的函数
        function sendPlayCompleteMessage() {
            originalConsoleLog('发送播放完成消息...');
            // 向父窗口发送消息（如果是在iframe中）
            if (window.parent !== window) {
                originalConsoleLog('向父窗口发送消息');
                window.parent.postMessage({ type: 'COURSE_PLAY_COMPLETE' }, '*');
            }
            // 同时向 opener 窗口发送消息（如果是通过 window.open 打开的）
            if (window.opener) {
                originalConsoleLog('向opener窗口发送消息');
                window.opener.postMessage({ type: 'COURSE_PLAY_COMPLETE' }, '*');
            }
        }
        
        // 重写console.log，检测播放完成提示
        console.log = function(...args) {
            const logText = args.join(' ');
            
            // 调用原始console.log，避免循环调用
            originalConsoleLog.apply(console, args);
            
            // 检测是否包含播放完成关键词
            if (isPlayComplete(logText)) {
                // 使用原始console.log输出，避免循环调用
                originalConsoleLog('播放页面检测到播放完成提示');
                // 发送播放完成消息
                sendPlayCompleteMessage();
                // 播放完成后等待3秒再关闭窗口
                originalConsoleLog('播放完成，3秒后关闭窗口...');
                setTimeout(() => {
                    window.close();
                }, 3000);
            }
        };
        
        isConsoleOverridden = true;
        
        // 同时添加定时器检测，防止console.log没有触发
        let playCheckTimer = setInterval(() => {
            // 可以添加其他检测逻辑，比如检查播放进度条
            // 示例：检查是否有播放完成的DOM元素
            const completeElement = document.querySelector('.play-complete, .course-finished');
            if (completeElement) {
                // 使用原始console.log输出，避免循环调用
                originalConsoleLog('通过DOM元素检测到播放完成');
                clearInterval(playCheckTimer);
                // 发送播放完成消息
                sendPlayCompleteMessage();
                // 播放完成后等待3秒再关闭窗口
                originalConsoleLog('播放完成，3秒后关闭窗口...');
                setTimeout(() => {
                    window.close();
                }, 3000);
            }
        }, config.checkInterval);
        
        // 监听窗口关闭事件，确保发送播放完成消息
        window.addEventListener('beforeunload', () => {
            originalConsoleLog('窗口即将关闭，发送播放完成消息...');
            sendPlayCompleteMessage();
        });
        
        // 使用原始console.log输出，避免循环调用
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
        // 使用原始console.log输出，避免循环调用
        originalConsoleLog(`找到${courseRows.length}个课程`);

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

            if (!progressSpan) {
                originalConsoleLog(`第${index+1}行未找到课程进度元素`);
                return;
            }

            // 获取进度百分比
            const progressLabel = progressSpan.querySelector('label');
            if (!progressLabel) {
                originalConsoleLog(`第${index+1}行未找到进度百分比元素`);
                return;
            }

            const progressText = progressLabel.textContent.trim();
            originalConsoleLog(`第${index+1}行课程进度：${progressText}`);

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
                    originalConsoleLog(`第${index+1}行添加到未完成课程队列`);
                    // 将课程信息添加到队列
                    courseQueue.push({
                        row: row,
                        learnBtn: learnBtn,
                        progress: progressText,
                        index: index + 1
                    });
                } else {
                    originalConsoleLog(`第${index+1}行未找到学习课程按钮`);
                }
            }
        });
        
        // 检测当前页面是否所有课程都是100%
        return courseRows.length > 0 && courseQueue.length === 0;
    }

    /**
     * 设置console事件监听
     */
    function setupConsoleListener() {
        // 防止重复重写console.log
        if (isConsoleOverridden) {
            originalConsoleLog('console.log已被重写，跳过设置');
            return;
        }
        
        // 重写console.log，检测播放完成提示
        console.log = function(...args) {
            const logText = args.join(' ');
            
            // 调用原始console.log，避免循环调用
            originalConsoleLog.apply(console, args);
            
            // 检测是否包含播放完成关键词
            if (isPlayComplete(logText)) {
                // 使用原始console.log输出，避免循环调用
                originalConsoleLog('检测到播放完成提示，准备处理下一个课程');
                handlePlayComplete();
            }
        };
        
        isConsoleOverridden = true;
        originalConsoleLog('已设置console事件监听');
    }
    
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
        
        // 播放完成后等待2秒提示，然后再等待8秒处理下一个课程，总共10秒
        originalConsoleLog('当前课程播放完成，2秒后开始播放下一个课程...');
        setTimeout(() => {
            originalConsoleLog('准备开始播放下一个课程...');
            // 处理下一个课程，让列表界面有足够时间加载和更新
            setTimeout(processNextCourse, 8000);
        }, 2000);
    }

    /**
     * 处理下一个课程
     */
    function processNextCourse() {
        // 如果队列为空，结束处理
        if (courseQueue.length === 0) {
            originalConsoleLog('所有课程处理完成');
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
        originalConsoleLog(`开始处理第${currentCourse.index}个课程，进度：${currentCourse.progress}`);
        
        // 记录开始时间
        startTime = Date.now();
        
        // 添加消息事件监听器，接收来自播放页面的消息（防止重复添加）
        if (!isMessageListenerAdded) {
            window.addEventListener('message', handleMessageEvent);
            isMessageListenerAdded = true;
            originalConsoleLog('已添加消息事件监听器');
        }
        
        // 模拟点击学习课程按钮，打开新窗口
        try {
            // 先尝试直接点击
            originalConsoleLog('准备点击学习课程按钮...');
            currentCourse.learnBtn.click();
            originalConsoleLog('已点击学习课程按钮');
            
            // 开始检测播放完成
            startCheckPlayComplete();
        } catch (e) {
            originalConsoleLog.error('打开课程失败:', e.message);
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
                originalConsoleLog('消息已处理，忽略重复消息');
                return;
            }
            
            // 检查处理频率，至少间隔5秒
            const now = Date.now();
            if (now - lastProcessTime < 5000) {
                originalConsoleLog('处理频率过高，忽略消息');
                return;
            }
            
            originalConsoleLog('收到播放完成消息，准备处理下一个课程');
            
            // 设置消息已处理标记
            messageReceived = true;
            lastProcessTime = now;
            
            // 处理下一个课程
            handlePlayComplete();
        }
    }

    /**
     * 开始检测播放完成
     */
    function startCheckPlayComplete() {
        // 使用原始console.log输出，避免循环调用
        originalConsoleLog('开始检测播放完成事件');
        
        // 设置定时器，定期检测
        checkTimer = setInterval(() => {
            // 检查是否超过最大等待时间
            if (Date.now() - startTime > config.maxWaitTime) {
                originalConsoleLog('单个课程处理超时，跳过该课程');
                handlePlayComplete();
                return;
            }
            
            // 输出调试信息，显示当前状态
            originalConsoleLog('检测播放完成中... 已等待:', Math.floor((Date.now() - startTime) / 1000), '秒');
            
            // 这里可以添加其他检测逻辑，比如检查当前窗口状态
            // 由于浏览器安全限制，可能无法直接访问跨域窗口的内容
            
        }, config.checkInterval);
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