// ==UserScript==
// @name         小红书 Hovercard 触发工具（精简版）
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  触发小红书笔记详情页的用户信息hovercard - 精简核心代码
// @author       Bin Chen
// @match        https://www.xiaohongshu.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=xiaohongshu.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    console.log('[Hover] 精简版脚本加载');

    // 获取上下文
    function getContext() {
        const modal = document.querySelector('.note-detail-mask') || 
                     document.querySelector('.note-container') ||
                     document.querySelector('.note-detail');
        return modal || document;
    }

    // 查找 .info 元素（关键元素）
    function findInfoElement() {
        const context = getContext();
        const infoElement = context.querySelector('.info');
        if (infoElement) {
            console.log('[Hover] ✅ 找到 .info 元素');
            return infoElement;
        }
        console.warn('[Hover] ⚠️ 未找到 .info 元素');
        return null;
    }

    // 创建完整的鼠标事件
    function createMouseEvent(type, x, y, relatedTarget = null) {
        return new MouseEvent(type, {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            screenX: x + window.screenX,
            screenY: y + window.screenY,
            pageX: x + window.pageXOffset,
            pageY: y + window.pageYOffset,
            buttons: 0,
            button: 0,
            detail: 0,
            relatedTarget: relatedTarget,
            which: 0,
            shiftKey: false,
            ctrlKey: false,
            altKey: false,
            metaKey: false
        });
    }

    // 模拟鼠标移动到元素上（核心方法）
    async function moveMouseToElement(element) {
        console.log('[Hover] 开始模拟鼠标移动...');
        
        const rect = element.getBoundingClientRect();
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        
        // 模拟从元素上方移动到元素中心
        const steps = 15;
        const startY = rect.y - 50;
        const endY = centerY;
        const startX = centerX;
        
        // 获取父元素链
        const parentChain = [];
        let parent = element.parentElement;
        while (parent && parentChain.length < 5) {
            parentChain.push(parent);
            parent = parent.parentElement;
        }
        
        let enteredElement = false;
        
        // 逐步移动鼠标
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            const currentY = startY + (endY - startY) * progress;
            const currentX = startX;
            
            const isInElement = currentY >= rect.y && currentY <= rect.y + rect.height &&
                               currentX >= rect.x && currentX <= rect.x + rect.width;
            
            // 创建 mousemove 事件
            const moveEvent = createMouseEvent('mousemove', currentX, currentY);
            
            // 在 document 和父元素上触发
            document.dispatchEvent(moveEvent);
            parentChain.forEach(p => p.dispatchEvent(moveEvent));
            
            // 如果鼠标进入元素区域
            if (isInElement && !enteredElement) {
                enteredElement = true;
                console.log(`[Hover] 鼠标进入元素区域 (步骤 ${i}/${steps})`);
                
                // 触发 mouseover
                const overEvent = createMouseEvent('mouseover', currentX, currentY, document.body);
                document.dispatchEvent(overEvent);
                parentChain.forEach(p => p.dispatchEvent(overEvent));
                element.dispatchEvent(overEvent);
                
                // 触发 mouseenter
                const enterEvent = createMouseEvent('mouseenter', currentX, currentY, null);
                element.dispatchEvent(enterEvent);
                parentChain.forEach(p => {
                    const parentEnterEvent = createMouseEvent('mouseenter', currentX, currentY, null);
                    p.dispatchEvent(parentEnterEvent);
                });
            }
            
            // 如果鼠标在元素内，在元素上触发 mousemove
            if (isInElement) {
                element.dispatchEvent(moveEvent);
            }
            
            // 延迟
            await new Promise(resolve => setTimeout(resolve, 15));
        }
        
        // 最后在元素中心触发完整的事件序列
        console.log('[Hover] 在元素中心触发最终事件...');
        const finalEvents = [
            { type: 'mousemove', relatedTarget: null },
            { type: 'mouseover', relatedTarget: document.body },
            { type: 'mouseenter', relatedTarget: null }
        ];
        
        for (const eventConfig of finalEvents) {
            const event = createMouseEvent(eventConfig.type, centerX, centerY, eventConfig.relatedTarget);
            document.dispatchEvent(event);
            parentChain.forEach(p => p.dispatchEvent(event));
            element.dispatchEvent(event);
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        console.log('[Hover] ✅ 鼠标移动模拟完成');
    }

    // 触发hovercard（主函数）
    async function triggerHovercard() {
        console.log('[Hover] ========== 开始触发hovercard ==========');
        
        // 查找 .info 元素
        const infoElement = findInfoElement();
        if (!infoElement) {
            console.error('[Hover] ❌ 未找到 .info 元素');
            return false;
        }
        
        // 模拟鼠标移动
        await moveMouseToElement(infoElement);
        
        // 等待hovercard出现（简单检查）
        console.log('[Hover] 等待hovercard出现...');
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 300));
            // 简单检查：查找可能的hovercard元素
            const hovercard = document.querySelector('.tooltip-container, .tooltip-content, [class*="tooltip"], [class*="hovercard"], [class*="user-card"]');
            if (hovercard) {
                const style = window.getComputedStyle(hovercard);
                if (style.display !== 'none' && style.opacity !== '0') {
                    console.log('[Hover] ✅ hovercard已出现！');
                    return true;
                }
            }
        }
        
        console.log('[Hover] ⚠️ hovercard未出现');
        return false;
    }

    // 创建触发按钮
    function createTriggerButton() {
        // 检查是否已经存在按钮
        if (document.getElementById('xhs-hovercard-trigger-btn')) {
            return;
        }

        const btn = document.createElement('button');
        btn.id = 'xhs-hovercard-trigger-btn';
        btn.textContent = '触发用户信息';
        btn.title = '点击触发用户信息hovercard';
        
        // 添加样式
        btn.style.cssText = `
            position: fixed !important;
            bottom: 150px !important;
            right: 20px !important;
            z-index: 10000 !important;
            background: linear-gradient(135deg, #ff2442 0%, #ff6b8a 100%) !important;
            color: white !important;
            border: none !important;
            border-radius: 8px !important;
            padding: 10px 16px !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            cursor: pointer !important;
            box-shadow: 0 4px 12px rgba(255, 36, 66, 0.4) !important;
            transition: all 0.3s ease !important;
        `;

        // 添加hover效果
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'scale(1.05)';
            btn.style.boxShadow = '0 6px 16px rgba(255, 36, 66, 0.6)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'scale(1)';
            btn.style.boxShadow = '0 4px 12px rgba(255, 36, 66, 0.4)';
        });

        // 点击事件
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '触发中...';
            btn.style.opacity = '0.7';
            
            try {
                const success = await triggerHovercard();
                if (success) {
                    btn.textContent = '✅ 已触发';
                    btn.style.background = 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)';
                    setTimeout(() => {
                        btn.textContent = '触发用户信息';
                        btn.style.background = 'linear-gradient(135deg, #ff2442 0%, #ff6b8a 100%)';
                    }, 2000);
                } else {
                    btn.textContent = '❌ 失败';
                    btn.style.background = 'linear-gradient(135deg, #f5222d 0%, #ff4d4f 100%)';
                    setTimeout(() => {
                        btn.textContent = '触发用户信息';
                        btn.style.background = 'linear-gradient(135deg, #ff2442 0%, #ff6b8a 100%)';
                    }, 2000);
                }
            } catch (e) {
                console.error('[Hover] 按钮触发失败:', e);
                btn.textContent = '❌ 错误';
                btn.style.background = 'linear-gradient(135deg, #f5222d 0%, #ff4d4f 100%)';
                setTimeout(() => {
                    btn.textContent = '触发用户信息';
                    btn.style.background = 'linear-gradient(135deg, #ff2442 0%, #ff6b8a 100%)';
                }, 2000);
            } finally {
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        });

        // 添加到页面
        document.body.appendChild(btn);
        console.log('[Hover] ✅ 触发按钮已创建');
    }

    // 初始化：在笔记详情页创建按钮
    function init() {
        // 检查是否是笔记详情页
        const isNotePage = window.location.pathname.includes('/explore/') || 
                         window.location.pathname.includes('/discovery/item/') ||
                         document.querySelector('.note-detail-mask, .note-container, .note-detail');
        
        if (isNotePage) {
            // 等待页面加载完成
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    setTimeout(createTriggerButton, 1000);
                });
            } else {
                setTimeout(createTriggerButton, 1000);
            }
        }
    }

    // 监听页面变化（SPA路由）
    let lastUrl = window.location.href;
    const checkUrlChange = () => {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            setTimeout(init, 500);
        }
    };

    // 使用 MutationObserver 监听URL变化
    const observer = new MutationObserver(checkUrlChange);
    observer.observe(document.body, { childList: true, subtree: true });

    // 监听 popstate 事件
    window.addEventListener('popstate', checkUrlChange);

    // 监听 pushState/replaceState
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function(...args) {
        originalPushState.apply(history, args);
        setTimeout(checkUrlChange, 100);
    };
    history.replaceState = function(...args) {
        originalReplaceState.apply(history, args);
        setTimeout(checkUrlChange, 100);
    };

    // 初始执行
    init();

    // 导出到全局
    window.triggerHovercard = triggerHovercard;
    window.findInfoElement = findInfoElement;
    window.moveMouseToElement = moveMouseToElement;
    
    console.log('[Hover] 精简版脚本加载完成');
    console.log('[Hover] 使用方法: triggerHovercard() 或点击"触发用户信息"按钮');

})();
