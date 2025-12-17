// PWA Installation and Service Worker Registration
(function() {
    'use strict';

    let deferredPrompt;
    let installButton;

    // Detect iOS/iPadOS
    function isIOS() {
        const userAgent = window.navigator.userAgent.toLowerCase();
        return /iphone|ipad|ipod/.test(userAgent) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+
    }

    // Detect if user is on Safari
    function isSafari() {
        const userAgent = window.navigator.userAgent.toLowerCase();
        return /safari/.test(userAgent) && !/chrome|crios|fxios/.test(userAgent);
    }

    // Check if already installed
    function isInstalled() {
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.navigator.standalone ||
               document.referrer.includes('android-app://');
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/public/service-worker.js')
                .then((registration) => {
                    console.log('✅ Service Worker registered successfully:', registration.scope);

                    // Check for updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        console.log('🔄 Service Worker update found');

                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                // New service worker available, prompt user to refresh
                                showUpdateNotification();
                            }
                        });
                    });
                })
                .catch((error) => {
                    console.error('❌ Service Worker registration failed:', error);
                });

            // Check for updates every hour
            setInterval(() => {
                navigator.serviceWorker.getRegistration().then((registration) => {
                    if (registration) {
                        registration.update();
                    }
                });
            }, 60 * 60 * 1000);
        });

        // Show iOS install instructions if applicable
        if (isIOS() && isSafari() && !isInstalled()) {
            // Delay showing the banner to avoid overwhelming the user on page load
            setTimeout(() => {
                showIOSInstallInstructions();
            }, 3000);
        }
    }

    // Function to show iOS-specific install instructions
    function showIOSInstallInstructions() {
        // Check if user has dismissed the banner recently (within 7 days)
        const dismissedTime = localStorage.getItem('ios-install-dismissed');
        if (dismissedTime && (Date.now() - parseInt(dismissedTime)) < 7 * 24 * 60 * 60 * 1000) {
            return;
        }

        const iosInstallBanner = document.createElement('div');
        iosInstallBanner.id = 'ios-install-banner';
        iosInstallBanner.innerHTML = `
            <div style="
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 1.25rem;
                border-radius: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.3);
                z-index: 10000;
                max-width: 400px;
                width: calc(100vw - 40px);
                animation: slideUp 0.4s ease-out;
            ">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
                    <div style="font-weight: 700; font-size: 1.1rem;">
                        📱 Install RehabPlus
                    </div>
                    <button id="ios-dismiss-btn" style="
                        background: transparent;
                        color: white;
                        border: none;
                        padding: 0;
                        cursor: pointer;
                        font-size: 1.5rem;
                        line-height: 1;
                        margin-left: 1rem;
                    ">×</button>
                </div>
                <div style="font-size: 0.9rem; opacity: 0.95; margin-bottom: 1rem;">
                    Install this app on your ${/ipad/.test(navigator.userAgent.toLowerCase()) ? 'iPad' : 'iPhone'} for quick access:
                </div>
                <div style="background: rgba(255,255,255,0.15); padding: 1rem; border-radius: 8px; font-size: 0.875rem; line-height: 1.6;">
                    <div style="display: flex; align-items: center; margin-bottom: 0.75rem;">
                        <div style="font-size: 1.5rem; margin-right: 0.75rem;">1️⃣</div>
                        <div>Tap the <strong>Share</strong> button
                            <svg width="16" height="20" viewBox="0 0 16 20" fill="white" style="display: inline-block; vertical-align: middle; margin: 0 0.25rem;">
                                <path d="M8 0L8 12M8 0L4 4M8 0L12 4M2 8v10a2 2 0 002 2h8a2 2 0 002-2V8" stroke="white" stroke-width="2" fill="none"/>
                            </svg>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center;">
                        <div style="font-size: 1.5rem; margin-right: 0.75rem;">2️⃣</div>
                        <div>Select <strong>"Add to Home Screen"</strong>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="white" style="display: inline-block; vertical-align: middle; margin-left: 0.25rem;">
                                <path d="M12 5v14m-7-7h14" stroke="white" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideUp {
                from {
                    transform: translate(-50%, 100px);
                    opacity: 0;
                }
                to {
                    transform: translate(-50%, 0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(iosInstallBanner);

        const dismissButton = document.getElementById('ios-dismiss-btn');
        dismissButton.addEventListener('click', () => {
            iosInstallBanner.remove();
            localStorage.setItem('ios-install-dismissed', Date.now().toString());
        });

        // Auto-dismiss after 45 seconds
        setTimeout(() => {
            if (document.getElementById('ios-install-banner')) {
                iosInstallBanner.remove();
            }
        }, 45000);
    }

    // PWA Install Prompt (for Android/Desktop)
    window.addEventListener('beforeinstallprompt', (e) => {
        console.log('💾 PWA install prompt triggered');

        // Prevent the default install prompt
        e.preventDefault();

        // Store the event for later use
        deferredPrompt = e;

        // Show custom install button
        showInstallButton();
    });

    // Function to show custom install button (for Android/Desktop)
    function showInstallButton() {
        // Don't show if already dismissed recently
        const dismissedTime = localStorage.getItem('pwa-install-dismissed');
        if (dismissedTime && (Date.now() - parseInt(dismissedTime)) < 7 * 24 * 60 * 60 * 1000) {
            return;
        }

        // Create install banner
        const installBanner = document.createElement('div');
        installBanner.id = 'pwa-install-banner';
        installBanner.innerHTML = `
            <div style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 1rem 1.5rem;
                border-radius: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                z-index: 10000;
                display: flex;
                align-items: center;
                gap: 1rem;
                max-width: 350px;
                animation: slideIn 0.3s ease-out;
            ">
                <div style="flex: 1;">
                    <div style="font-weight: 700; font-size: 1rem; margin-bottom: 0.25rem;">
                        📱 Install RehabPlus
                    </div>
                    <div style="font-size: 0.875rem; opacity: 0.9;">
                        Install this app on your device for quick access
                    </div>
                </div>
                <button id="pwa-install-btn" style="
                    background: white;
                    color: #667eea;
                    border: none;
                    padding: 0.5rem 1rem;
                    border-radius: 6px;
                    font-weight: 600;
                    cursor: pointer;
                    white-space: nowrap;
                    transition: transform 0.2s;
                ">
                    Install
                </button>
                <button id="pwa-dismiss-btn" style="
                    background: transparent;
                    color: white;
                    border: none;
                    padding: 0.5rem;
                    cursor: pointer;
                    font-size: 1.2rem;
                    line-height: 1;
                ">
                    ×
                </button>
            </div>
        `;

        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateY(100px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }

            #pwa-install-btn:hover {
                transform: scale(1.05);
            }

            @media (max-width: 768px) {
                #pwa-install-banner > div {
                    max-width: calc(100vw - 40px);
                    flex-direction: column;
                    text-align: center;
                }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(installBanner);

        installButton = document.getElementById('pwa-install-btn');
        const dismissButton = document.getElementById('pwa-dismiss-btn');

        installButton.addEventListener('click', installPWA);
        dismissButton.addEventListener('click', () => {
            installBanner.remove();
            // Remember user dismissed (store in localStorage)
            localStorage.setItem('pwa-install-dismissed', Date.now().toString());
        });

        // Auto-dismiss after 30 seconds
        setTimeout(() => {
            if (document.getElementById('pwa-install-banner')) {
                installBanner.remove();
            }
        }, 30000);
    }

    // Install PWA
    async function installPWA() {
        if (!deferredPrompt) {
            console.log('❌ No install prompt available');
            return;
        }

        // Show the install prompt
        deferredPrompt.prompt();

        // Wait for the user's response
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`👤 User response: ${outcome}`);

        if (outcome === 'accepted') {
            console.log('✅ User accepted the install prompt');
        } else {
            console.log('❌ User dismissed the install prompt');
        }

        // Clear the deferredPrompt
        deferredPrompt = null;

        // Remove install banner
        const banner = document.getElementById('pwa-install-banner');
        if (banner) {
            banner.remove();
        }
    }

    // App installed event
    window.addEventListener('appinstalled', () => {
        console.log('🎉 PWA was installed successfully');

        // Hide install button if visible
        const banner = document.getElementById('pwa-install-banner');
        if (banner) {
            banner.remove();
        }

        // Show success message
        if (typeof showAlert === 'function') {
            showAlert('App installed successfully! You can now access RehabPlus from your home screen.', 'success');
        }

        deferredPrompt = null;
    });

    // Show update notification when new version is available
    function showUpdateNotification() {
        if (typeof showAlert === 'function') {
            const updateBanner = document.createElement('div');
            updateBanner.className = 'alert alert-info alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3';
            updateBanner.style.zIndex = '9999';
            updateBanner.innerHTML = `
                <strong>🔄 Update Available!</strong> A new version is ready.
                <button class="btn btn-sm btn-primary ms-3" onclick="window.location.reload()">Refresh Now</button>
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            `;
            document.body.appendChild(updateBanner);
        }
    }

    // Log PWA status
    if (isInstalled()) {
        console.log('📱 Running as installed PWA');

        // Add PWA-specific styles
        document.documentElement.classList.add('pwa-mode');
    } else {
        console.log('🌐 Running in browser');
    }

    // Expose install function globally
    window.installPWA = installPWA;

})();