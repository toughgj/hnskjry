// ==UserScript==
// @name         ZZU网课助手-终极鲁棒版
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  视频防暂停 + 自动答题 + 自动关窗 + 延迟启动防止计时器失效
// @match        https://zdkj.v.zzu.edu.cn/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 核心业务逻辑 (封装在 startBusinessLogic 中)
    // ==========================================
    function startBusinessLogic() {
        console.log('🚀 核心业务逻辑已启动');

        // ========== 视频控制逻辑 ==========
        let currentVideo = null;
        let videoObserved = false;

        function initVideoControl(video) {
            if (videoObserved) return;
            videoObserved = true;
            currentVideo = video;

            console.log('✅ [业务] 捕获到视频元素', video);

            // 静音并播放
            video.muted = true;
            const playVideo = () => {
                video.play().then(() => {
                    console.log('🎉 [业务] 视频播放成功');
                }).catch(err => {
                    console.warn('⚠️ [业务] 播放被阻止:', err.message);
                    setTimeout(playVideo, 2000);
                });
            };

            playVideo();

            // 监听暂停事件
            video.addEventListener('pause', () => {
                if (video.ended) return;

                setTimeout(() => {
                    const hasExamDialog = document.querySelector('.m-exam-dialog');
                    if (hasExamDialog) {
                        console.log('⏸️ [业务] 检测到答题弹窗，允许暂停');
                        return;
                    }

                    if (video.paused && !video.ended) {
                        console.log('🔁 [业务] 非答题暂停，尝试恢复播放...');
                        playVideo();
                    }
                }, 300);
            });

            // 监听结束事件
            video.addEventListener('ended', () => {
                console.log('🏁 [业务] 视频结束，查找下一节按钮...');
                const nextBtn = document.querySelector('.next.ng-scope a[ng-click*="playNext"]');
                if (nextBtn) {
                    console.log('⏭️ [业务] 点击下一节');
                    nextBtn.click();
                }
                else
                {
                    console.log('🏁 [业务] 脚本全部完成');
                }
            });

            // 定期检查视频状态
            const videoCheckInterval = setInterval(() => {
                if (video.ended) {
                    clearInterval(videoCheckInterval);
                    return;
                }

                const hasExamDialog = document.querySelector('.m-exam-dialog');
                if (!hasExamDialog && video.paused && !video.ended) {
                    console.log('🔄 [业务] 定期检查发现视频暂停，尝试恢复');
                    playVideo();
                }
            }, 5000);
        }

        // ========== 安全计算（完整版）==========
        function tokenize(expr) {
            const tokens = [];
            let i = 0;
            while (i < expr.length) {
                const ch = expr[i];
                if (/\s/.test(ch)) { i++; continue; }
                if (/[0-9.]/.test(ch)) {
                    let num = '';
                    while (i < expr.length && /[0-9.]/.test(expr[i])) {
                        num += expr[i++];
                    }
                    if ((num.match(/\./g) || []).length > 1) throw new Error('无效数字');
                    tokens.push(parseFloat(num));
                } else if ('+-*/()'.includes(ch)) {
                    tokens.push(ch);
                    i++;
                } else {
                    throw new Error('非法字符: ' + ch);
                }
            }
            return tokens;
        }

        function parseExpression(tokens) {
            let pos = 0;
            function peek() { return pos < tokens.length ? tokens[pos] : null; }
            function consume() { return tokens[pos++]; }

            function parseAtom() {
                const token = peek();
                if (typeof token === 'number') { consume(); return token; }
                if (token === '(') {
                    consume();
                    const expr = parseAddSub();
                    if (peek() !== ')') throw new Error('缺少右括号');
                    consume();
                    return expr;
                }
                if (token === '-') { consume(); return -parseAtom(); }
                if (token === '+') { consume(); return parseAtom(); }
                throw new Error('语法错误');
            }

            function parseMulDiv() {
                let left = parseAtom();
                while (peek() === '*' || peek() === '/') {
                    const op = consume();
                    const right = parseAtom();
                    if (op === '*') left *= right;
                    else {
                        if (right === 0) throw new Error('除零错误');
                        left /= right;
                    }
                }
                return left;
            }

            function parseAddSub() {
                let left = parseMulDiv();
                while (peek() === '+' || peek() === '-') {
                    const op = consume();
                    const right = parseMulDiv();
                    if (op === '+') left += right;
                    else left -= right;
                }
                return left;
            }

            const result = parseAddSub();
            if (pos < tokens.length) throw new Error('多余内容');
            return result;
        }

        function safeCalculate(rawQuestion) {
            const cleaned = rawQuestion
                .replace(/＝/g, '=')
                .replace(/？/g, '?')
                .replace(/×/g, '*')
                .replace(/÷/g, '/')
                .replace(/x/g, '*')
                .replace(/\s+/g, ' ');

            let exprMatch = cleaned.match(/([\d\s()+\-*/.]+)/);
            if (!exprMatch) {
                const fallbackMatch = cleaned.match(/[\d.]+(?:\s*[+\-*/]\s*[\d.()]+)*/);
                if (fallbackMatch) exprMatch = [null, fallbackMatch[0]];
                else throw new Error('未找到有效表达式');
            }

            let expr = exprMatch[1].trim();
            if (!expr) throw new Error('表达式为空');
            if (!/^[0-9+\-*/().\s]+$/.test(expr)) throw new Error('表达式含非法字符');

            const tokens = tokenize(expr);
            let result = parseExpression(tokens);
            if (!isFinite(result)) throw new Error('结果无效');
            if (Math.abs(result) > 1e10) throw new Error('结果过大');
            return Math.round(result * 1e10) / 1e10;
        }

        function triggerNativeClick(el) {
            if (!el) return;
            ['mousedown', 'mouseup', 'click'].forEach(type => {
                const event = new MouseEvent(type, {
                    view: window,
                    bubbles: true,
                    cancelable: true
                });
                el.dispatchEvent(event);
            });
        }

        // ========== 改进的关闭逻辑 ==========
        function tryCloseDialog() {
            const dialog = document.querySelector('.m-exam-dialog');
            if (!dialog) return false;

            const closeBtn = dialog.querySelector('button[data-action="close"]');
            if (closeBtn && closeBtn.offsetParent !== null) {
                triggerNativeClick(closeBtn);
                console.log('✅ [业务] 已自动关闭对话框');
                return true;
            }

            const closeSelectors = [
                'button[data-action="close"]',
                '.close',
                '.cancel',
                '[aria-label*="close" i]',
                '[title*="close" i]'
            ];

            for (const selector of closeSelectors) {
                const btn = dialog.querySelector(selector);
                if (btn && btn.offsetParent !== null) {
                    triggerNativeClick(btn);
                    console.log('✅ [业务] 已通过备用选择器关闭对话框');
                    return true;
                }
            }

            return false;
        }

        // ========== 延时关闭机制 ==========
        let closeTimeoutId = null;

        function scheduleCloseDialog() {
            if (closeTimeoutId) {
                clearTimeout(closeTimeoutId);
            }

            closeTimeoutId = setTimeout(() => {
                if (tryCloseDialog()) {
                    console.log('⏰ [业务] 定时关闭成功');
                } else {
                    console.log('⏰ [业务] 定时关闭失败，对话框可能已关闭');
                }
                closeTimeoutId = null;
            }, 800);
        }

        // ========== 主答题逻辑 ==========
        let isProcessing = false;

        function autoAnswer() {
            if (isProcessing) return;
            isProcessing = true;

            try {
                const dialog = document.querySelector('.m-exam-dialog');
                if (!dialog) {
                    isProcessing = false;
                    return;
                }

                const questionEl = dialog.querySelector('[data-id="topic"]');
                const configEls = [...dialog.querySelectorAll('[data-id="configItem"] .d-slt')];

                // 如果没有选项但有对话框，尝试关闭
                if (configEls.length === 0) {
                    console.log('📝 [业务] 检测到无选项对话框，尝试关闭');
                    tryCloseDialog();
                    return;
                }

                const firstOptionRadio = configEls[0]?.querySelector('input[type="radio"]');
                let foundAnswer = false;

                if (questionEl) {
                    const questionText = questionEl.innerText.trim();
                    console.log('📝 [业务] 题目:', questionText);

                    try {
                        const correctValue = safeCalculate(questionText);
                        console.log('✅ [业务] 计算结果:', correctValue);

                        for (const el of configEls) {
                            const contentEl = el.querySelector('.ipt-txt-content');
                            if (!contentEl) continue;
                            const text = contentEl.innerText.trim();
                            const val = parseFloat(text);
                            if (!isNaN(val) && Math.abs(val - correctValue) < 1e-9) {
                                const radio = el.querySelector('input[type="radio"]');
                                if (radio && !radio.checked) {
                                    triggerNativeClick(radio);
                                    console.log('☑️ [业务] 已选择正确答案');
                                }
                                foundAnswer = true;
                                break;
                            }
                        }
                    } catch (e) {
                        console.warn('⚠️ [业务] 计算失败，使用默认选项:', e.message || e);
                    }
                }

                if (!foundAnswer && firstOptionRadio && !firstOptionRadio.checked) {
                    triggerNativeClick(firstOptionRadio);
                    console.log('🔘 [业务] 未识别题目，已选择第一个选项');
                }

                const submitBtn = dialog.querySelector('button[data-action="answer"]');
                if (submitBtn && submitBtn.offsetParent !== null) {
                    triggerNativeClick(submitBtn);
                    console.log('📤 [业务] 已提交答案');

                    // 提交后安排关闭对话框
                    scheduleCloseDialog();
                } else {
                    // 如果没有提交按钮但有对话框，也尝试关闭
                    scheduleCloseDialog();
                }
            } finally {
                setTimeout(() => isProcessing = false, 500);
            }
        }

        // ========== 观察器初始化 (长期运行) ==========
        let observer = null;
        let intervalId = null;

        function initObserver() {
            if (observer) {
                observer.disconnect();
            }

            observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // 检测视频元素 (处理下一节切换时新加载的视频)
                            if (node.tagName === 'VIDEO' && (node.src?.includes('hwcloud') || node.id?.includes('baby_html5_api'))) {
                                // 重置状态以控制新视频
                                videoObserved = false;
                                initVideoControl(node);
                            } else if (node.querySelector) {
                                const video = node.querySelector('video[src*="hwcloud"], video[id*="baby_html5_api"]');
                                if (video) {
                                    videoObserved = false;
                                    initVideoControl(video);
                                }

                                // 检测答题弹窗
                                if (node.querySelector('.m-exam-dialog')) {
                                    console.log('🔍 [业务] 检测到答题弹窗，准备答题');
                                    setTimeout(autoAnswer, 100);
                                }
                            }
                        }
                    }
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        function initIntervalCheck() {
            if (intervalId) {
                clearInterval(intervalId);
            }

            intervalId = setInterval(() => {
                // 检查答题弹窗
                const dialog = document.querySelector('.m-exam-dialog');
                if (dialog) {
                    console.log('🔄 [业务] 定期检查发现答题弹窗');
                    autoAnswer();
                }

                // 检查视频状态
                if (currentVideo && !currentVideo.ended && currentVideo.paused) {
                    const hasExamDialog = document.querySelector('.m-exam-dialog');
                    if (!hasExamDialog) {
                        console.log('🔄 [业务] 定期检查发现视频暂停，尝试恢复');
                        currentVideo.play().catch(err => {
                            console.warn('恢复播放失败:', err.message);
                        });
                    }
                }
            }, 3000);
        }

        function handleVisibilityChange() {
            if (!document.hidden) {
                setTimeout(() => {
                    if (tryCloseDialog()) {
                        console.log('🔄 [业务] 从后台返回时关闭了对话框');
                    }
                }, 100);
            }
        }

        // ========== 启动所有业务功能 ==========
        initObserver();
        initIntervalCheck();
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // 初始检查：如果此刻已经有视频（因为我们延迟了启动，所以大概率是有的），立即接管
        const existingVideo = document.querySelector('video[src*="hwcloud"], video[id*="baby_html5_api"]');
        if (existingVideo) {
            initVideoControl(existingVideo);
        }

        const existingDialog = document.querySelector('.m-exam-dialog');
        if (existingDialog) {
            console.log('🔍 [业务] 初始检查发现答题弹窗');
            autoAnswer();
        }

        // 清理钩子
        window.autoAnswerCleanup = function cleanup() {
            if (observer) observer.disconnect();
            if (intervalId) clearInterval(intervalId);
            if (closeTimeoutId) clearTimeout(closeTimeoutId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
        window.addEventListener('beforeunload', window.autoAnswerCleanup);
    }


    // ==========================================
    // 延迟启动控制器 (Wait for Video & Delay)
    // ==========================================
    (function waitForVideoAndDelay() {
        console.log('🧪 [启动器] 脚本已加载，正在蹲守视频...');

        // 启动业务逻辑的方法（包含5秒等待）
        function startSafeProcess() {
            console.log('⏳ [启动器] 发现视频！正在等待 5 秒，避开网页初始化清理...');

            // 在页面显示状态（可选，方便调试）
            let div = document.createElement('div');
            div.style.cssText = 'position:fixed;top:0;left:0;background:rgba(0,0,0,0.7);color:#0f0;padding:5px;z-index:999999;font-size:12px;pointer-events:none;';
            div.innerText = '脚本就绪：等待页面加载...';
            document.body.appendChild(div);

            let countdown = 5;
            const countTimer = setInterval(() => {
                countdown--;
                div.innerText = `脚本就绪：安全倒计时 ${countdown}s`;
                if (countdown <= 0) {
                    clearInterval(countTimer);
                    div.innerText = '脚本已启动：运行中';
                    div.style.color = '#fff';
                    div.style.background = 'rgba(0,128,0,0.7)';
                    setTimeout(() => div.remove(), 3000); // 3秒后移除提示
                }
            }, 1000);

            // 核心延迟：5秒后执行 startBusinessLogic
            setTimeout(() => {
                startBusinessLogic();
            }, 5000);
        }

        // 1. 如果视频已经存在
        const video = document.querySelector('video');
        if (video) {
            startSafeProcess();
            return;
        }

        // 2. 如果视频还没出来，就用观察者等它
        const startupObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.tagName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
                        console.log('📹 [启动器] 动态捕获到视频元素');
                        startupObserver.disconnect(); // 找到了就停止这个启动观察者
                        startSafeProcess();
                        return;
                    }
                }
            }
        });

        startupObserver.observe(document.body, { childList: true, subtree: true });
    })();

})();