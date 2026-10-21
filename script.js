(() => {
    const scriptElement = document.currentScript;
    const siteRoot = new URL(scriptElement?.dataset.siteRoot || './', document.baseURI);
    const page = document.body.dataset.page;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const loadingStartedAt = performance.now();
    const minimumLoadingDuration = 2000;
    const loadingFadeDuration = reducedMotion ? 0 : 1000;
    const storageKey = 'archive-entered-this-tab';

    if (page === 'collection') {
        let enteredFromStart = false;
        try {
            enteredFromStart = sessionStorage.getItem(storageKey) === 'yes';
        } catch {
            enteredFromStart = false;
        }

        if (!enteredFromStart) {
            window.location.replace(new URL(document.body.dataset.landing || 'home.html', document.baseURI));
            return;
        }
    }

    const body = document.body;
    const galleryPage = page === 'home' || page === 'collection';
    if (page !== 'landing') body.classList.add('is-loading');

    let leavingPage = false;
    let soundEnabled = false;
    try {
        soundEnabled = sessionStorage.getItem('archive-sound') === 'on';
    } catch {
        soundEnabled = false;
    }
    let audioContext;
    let galleryData;
    let currentPhotos = [];
    let activeIndex = 0;
    let lastTrigger;
    let viewerOpenAnimation;
    let viewerClosing = false;
    let viewerSource;
    let touchOrigin;

    const photoGrid = document.querySelector('#photo-grid');
    const loadingBar = document.querySelector('.loading-bar');
    const galleryStatus = document.querySelector('#gallery-status');
    const collectionList = document.querySelector('#collection-list');
    const viewer = document.querySelector('#image-viewer');
    const viewerImage = document.querySelector('#viewer-image');
    const viewerCount = document.querySelector('#viewer-count');
    const viewerDetails = document.querySelector('#viewer-details');
    const viewerInfoPanel = document.querySelector('#viewer-info-panel');
    const viewerEnd = document.querySelector('#viewer-end');
    const viewerInfoButton = document.querySelector('#viewer-info');
    const previousButton = document.querySelector('#viewer-previous');
    const nextButton = document.querySelector('#viewer-next');

    function initializeHomeTitle() {
        const title = document.querySelector('.home-title');
        if (!title) return;

        const phrase = title.textContent.trim();
        const typeCount = 9;
        const timers = new Set();
        const words = phrase.split(' ').flatMap((word, index) => {
            const wordElement = document.createElement('span');
            wordElement.className = 'title-word';
            wordElement.setAttribute('aria-hidden', 'true');
            [...word].forEach((character, index) => {
                const glyph = document.createElement('span');
                glyph.className = `title-glyph type-${(index + word.length) % typeCount}`;
                glyph.textContent = character;
                wordElement.append(glyph);
            });
            return index === 0 ? [wordElement] : [document.createTextNode(' '), wordElement];
        });
        title.replaceChildren(...words);

        if (reducedMotion) return;

        const glyphs = [...title.querySelectorAll('.title-glyph')];
        glyphs.forEach((glyph) => {
            let currentType = Number(glyph.className.match(/type-(\d+)/)?.[1] || 0);
            let timer;
            const changeType = () => {
                timers.delete(timer);
                let nextType = Math.floor(Math.random() * typeCount);
                if (nextType === currentType) nextType = (nextType + 1) % typeCount;
                glyph.classList.replace(`type-${currentType}`, `type-${nextType}`);
                currentType = nextType;
                timer = window.setTimeout(changeType, 850 + Math.random() * 1850);
                timers.add(timer);
            };
            timer = window.setTimeout(changeType, 300 + Math.random() * 2200);
            timers.add(timer);
        });

        let frame = 0;
        const updateOpacity = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
                const fadeDistance = Math.max(window.innerHeight * 0.58, 1);
                const opacity = Math.max(0, 1 - window.scrollY / fadeDistance);
                title.style.opacity = String(opacity);
                frame = 0;
            });
        };
        window.addEventListener('scroll', updateOpacity, { passive: true });
        updateOpacity();
        window.addEventListener('pagehide', () => {
            timers.forEach((timer) => window.clearTimeout(timer));
            window.removeEventListener('scroll', updateOpacity);
            if (frame) window.cancelAnimationFrame(frame);
        }, { once: true });
    }

    initializeHomeTitle();

    function siteUrl(path) {
        return new URL(path, siteRoot);
    }

    async function finishLoading() {
        const remaining = Math.max(0, minimumLoadingDuration - (performance.now() - loadingStartedAt));
        if (remaining > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, remaining));
        }
        updateLoadingProgress(1, 1);
        body.classList.add('gallery-visible', 'is-ready');
        window.setTimeout(() => body.classList.remove('is-loading'), loadingFadeDuration);
    }

    function updateLoadingProgress(loaded, total) {
        const progress = total ? Math.min(loaded / total, 1) : 1;
        if (!loadingBar) return;
        loadingBar.style.setProperty('--loading-progress', progress);
        loadingBar.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    }

    function setStatus(message, isError = false) {
        if (!galleryStatus) return;
        galleryStatus.textContent = message;
        galleryStatus.hidden = false;
        if (isError) galleryStatus.setAttribute('role', 'alert');
    }

    function watchImage(image, onFailure, source) {
        return new Promise((resolve) => {
            let settled = false;
            const done = (loaded) => {
                if (settled) return;
                settled = true;
                if (!loaded) onFailure();
                window.setTimeout(resolve, 50);
            };
            image.addEventListener('load', () => done(true), { once: true });
            image.addEventListener('error', () => done(false), { once: true });
            image.src = source;
            if (image.complete) done(image.naturalWidth > 0);
        });
    }

    function createPhotoCard(photo, index) {
        const article = document.createElement('article');
        article.className = 'photo-card';
        article.style.setProperty('--item-index', index);
        article.dataset.layout = photo.layout === 'wide' || photo.layout === 2 ? 'wide' : 'normal';

        const button = document.createElement('button');
        button.className = 'photo-open';
        button.type = 'button';
        button.setAttribute('aria-label', `Open photograph: ${photo.alt || photo.id || `image ${index + 1}`}`);

        const image = document.createElement('img');
        image.className = 'gallery-image';
        image.alt = photo.alt || '';
        image.decoding = 'sync';
        image.loading = 'eager';
        if (index === 0) image.fetchPriority = 'high';
        if (Number.isFinite(photo.width) && photo.width > 0) image.width = photo.width;
        if (Number.isFinite(photo.height) && photo.height > 0) image.height = photo.height;
        if (image.width && image.height) {
            button.style.setProperty('--photo-ratio', `${image.width} / ${image.height}`);
        }

        const imageUrl = siteUrl(photo.src);
        const showImageError = () => {
            if (button.classList.contains('is-missing')) return;
            button.classList.add('is-missing');
            image.hidden = true;
            const error = document.createElement('span');
            error.className = 'photo-error';
            error.style.setProperty('--photo-ratio', image.width && image.height ? `${image.width} / ${image.height}` : '4 / 3');
            const identifier = document.createElement('span');
            identifier.textContent = photo.number || photo.id || `image ${index + 1}`;
            const message = document.createElement('span');
            message.textContent = 'file not found';
            error.append(identifier, message);
            button.append(error);
            console.error('Gallery image failed to load:', imageUrl.href);
        };
        image.addEventListener('error', showImageError, { once: true });
        const settled = watchImage(image, showImageError, imageUrl.href);

        button.append(image);
        button.addEventListener('click', () => openViewer(index, button));
        article.append(button);
        return { article, settled };
    }

    function renderPhotos(photos) {
        currentPhotos = photos;
        if (!photoGrid) return Promise.resolve();
        updateLoadingProgress(0, photos.length);
        const cards = photos.map(createPhotoCard);
        photoGrid.replaceChildren(...cards.map((card) => card.article));

        if (photos.length === 0) {
            setStatus('no photographs configured');
            return Promise.resolve();
        }
        if (galleryStatus) galleryStatus.hidden = true;
        let loaded = 0;
        return Promise.all(cards.map((card) => card.settled.then(() => {
            loaded += 1;
            updateLoadingProgress(loaded, cards.length);
        })));
    }

    function renderCollections() {
        if (!collectionList) return;
        const items = (galleryData.collections || []).map((collection) => {
            const item = document.createElement('li');
            const link = document.createElement('a');
            const title = document.createElement('span');
            link.href = siteUrl(collection.path).href;
            title.textContent = collection.title;
            link.append(title);
            item.append(link);
            return item;
        });
        collectionList.replaceChildren(...items);
        if (items.length === 0) setStatus('no collections configured');
    }

    function addViewerDetail(value) {
        if (!value) return;
        const detail = document.createElement('span');
        detail.textContent = value;
        viewerDetails.append(detail);
    }

    function updateViewerInfo(photo) {
        if (!viewerInfoPanel) return;

        const fields = [
            ['Exposure', photo.technical?.exposure],
            ['Exposure Mode', photo.technical?.exposureMode],
            ['Focal Lengths', photo.technical?.focalLength],
            ['Gamma', photo.technical?.gamma],
            ['ISO', photo.technical?.iso],
            ['Model & Make', photo.technical?.modelAndMake],
        ];
        const list = document.createElement('dl');
        list.className = 'viewer-info-list';
        fields.forEach(([label, value]) => {
            const row = document.createElement('div');
            row.className = 'viewer-info-row';
            const term = document.createElement('dt');
            term.textContent = label;
            const description = document.createElement('dd');
            description.textContent = value ?? '—';
            row.append(term, description);
            list.append(row);
        });
        viewerInfoPanel.replaceChildren(list);
    }

    function updateViewer(index, immediate = false) {
        if (!viewer || !currentPhotos[index]) return;
        activeIndex = index;
        const photo = currentPhotos[index];
        const displayNumber = photo.number || String(index + 1).padStart(2, '0');
        viewerCount.textContent = `${displayNumber} / ${String(currentPhotos.length).padStart(2, '0')}`;
        viewerDetails.replaceChildren();
        [photo.caption, photo.date, photo.location].forEach(addViewerDetail);
        updateViewerInfo(photo);
        viewerEnd.hidden = index !== currentPhotos.length - 1;
        previousButton.disabled = index === 0;
        nextButton.disabled = index === currentPhotos.length - 1;
        viewerImage.alt = photo.alt || '';
        viewerImage.classList.remove('is-missing');

        const replaceImage = () => {
            viewerImage.onload = () => viewerImage.classList.remove('is-changing');
            viewerImage.onerror = () => {
                viewerImage.classList.remove('is-changing');
                viewerImage.classList.add('is-missing');
                console.error('Gallery image failed to load:', siteUrl(photo.largeSrc || photo.src).href);
                addViewerDetail('file not found');
            };
            viewerImage.src = siteUrl(photo.largeSrc || photo.src).href;
            if (viewerImage.complete && viewerImage.naturalWidth > 0) viewerImage.classList.remove('is-changing');
        };

        if (immediate || reducedMotion) {
            replaceImage();
        } else {
            viewerImage.classList.add('is-changing');
            window.setTimeout(replaceImage, 70);
        }
    }

    function animateViewerFromThumbnail(sourceRect) {
        if (reducedMotion || !sourceRect || !viewerImage?.animate) return;

        const animate = () => {
            if (!viewer.open || !viewerImage.naturalWidth) return;
            const targetRect = viewerImage.getBoundingClientRect();
            if (!targetRect.width || !targetRect.height) return;

            viewerOpenAnimation?.cancel();
            viewerOpenAnimation = viewerImage.animate([
                {
                    transformOrigin: 'top left',
                    transform: `translate(${sourceRect.left - targetRect.left}px, ${sourceRect.top - targetRect.top}px) scale(${sourceRect.width / targetRect.width}, ${sourceRect.height / targetRect.height})`,
                },
                {
                    transformOrigin: 'top left',
                    transform: 'translate(0, 0) scale(1, 1)',
                },
            ], {
                duration: 700,
                easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
                fill: 'both',
            });
        };

        if (viewerImage.complete && viewerImage.naturalWidth > 0) {
            animate();
        } else {
            viewerImage.classList.add('is-changing');
            viewerImage.addEventListener('load', animate, { once: true });
        }
    }

    async function closeViewer() {
        if (!viewer?.open || viewerClosing) return;
        if (reducedMotion || !viewerImage?.animate) {
            viewer.close();
            return;
        }

        viewerClosing = true;
        if (viewer.classList.contains('info-open')) {
            viewer.classList.remove('info-open');
            viewerInfoButton?.setAttribute('aria-pressed', 'false');
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            const stage = viewer.querySelector('.viewer-stage');
            const layoutTransitions = stage.getAnimations({ subtree: true });
            await Promise.all(layoutTransitions.map((animation) => animation.finished.catch(() => {})));
            if (!viewer.open || !viewerClosing) return;
        }

        viewer.classList.add('is-closing');

        if (viewerOpenAnimation) {
            viewerOpenAnimation.reverse();
        } else {
            const thumbnail = photoGrid?.children[activeIndex]?.querySelector('.gallery-image');
            const sourceRect = thumbnail?.getBoundingClientRect();
            const imageRect = viewerImage.getBoundingClientRect();
            if (!sourceRect?.width || !sourceRect.height || !imageRect.width || !imageRect.height || !viewerImage.naturalWidth) {
                viewer.close();
                return;
            }

            viewerOpenAnimation = viewerImage.animate([
                { transformOrigin: 'top left', transform: 'translate(0, 0) scale(1, 1)' },
                {
                    transformOrigin: 'top left',
                    transform: `translate(${sourceRect.left - imageRect.left}px, ${sourceRect.top - imageRect.top}px) scale(${sourceRect.width / imageRect.width}, ${sourceRect.height / imageRect.height})`,
                },
            ], {
                duration: 700,
                easing: 'cubic-bezier(0.64, 0, 0.78, 0.39)',
                fill: 'both',
            });
        }

        viewerOpenAnimation.finished
            .then(() => {
                if (viewer.open && viewerClosing) viewer.close();
            })
            .catch(() => {});
    }

    function playTick() {
        if (!soundEnabled) return;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            audioContext ||= new AudioContextClass();
            if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
            const length = Math.floor(audioContext.sampleRate * 0.025);
            const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
            const channel = buffer.getChannelData(0);
            for (let index = 0; index < length; index += 1) {
                channel[index] = (Math.random() * 2 - 1) * (1 - index / length);
            }
            const source = audioContext.createBufferSource();
            const filter = audioContext.createBiquadFilter();
            const gain = audioContext.createGain();
            source.buffer = buffer;
            filter.type = 'bandpass';
            filter.frequency.value = 1700;
            gain.gain.setValueAtTime(0.012, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.025);
            source.connect(filter).connect(gain).connect(audioContext.destination);
            source.start();
        } catch {}
    }

    function openViewer(index, trigger) {
        if (!viewer || !currentPhotos[index]) return;
        const thumbnail = trigger.querySelector('.gallery-image');
        const sourceRect = thumbnail?.getBoundingClientRect();
        lastTrigger = trigger;
        viewerSource = trigger;
        viewerSource.classList.add('is-viewer-source');
        viewer.classList.remove('info-open');
        viewerInfoButton?.setAttribute('aria-pressed', 'false');
        updateViewer(index, true);
        viewer.showModal();
        animateViewerFromThumbnail(sourceRect);
        document.querySelector('#viewer-close')?.focus();
        playTick();
    }

    function moveViewer(direction) {
        if (viewerClosing) return;
        const nextIndex = activeIndex + direction;
        if (nextIndex < 0 || nextIndex >= currentPhotos.length) return;
        viewerOpenAnimation?.cancel();
        viewerOpenAnimation = undefined;
        viewerSource?.classList.remove('is-viewer-source');
        viewerSource = photoGrid?.children[nextIndex]?.querySelector('.photo-open');
        viewerSource?.classList.add('is-viewer-source');
        updateViewer(nextIndex);
        playTick();
    }

    document.querySelector('#viewer-close')?.addEventListener('click', closeViewer);
    viewerInfoButton?.addEventListener('click', () => {
        if (viewerClosing) return;
        const infoOpen = viewer.classList.toggle('info-open');
        viewerInfoButton.setAttribute('aria-pressed', String(infoOpen));
    });
    previousButton?.addEventListener('click', () => moveViewer(-1));
    nextButton?.addEventListener('click', () => moveViewer(1));
    viewer?.addEventListener('close', () => {
        viewerOpenAnimation?.cancel();
        viewerOpenAnimation = undefined;
        viewerClosing = false;
        viewerSource?.classList.remove('is-viewer-source');
        viewerSource = undefined;
        viewer.classList.remove('is-closing');
        viewer.classList.remove('info-open');
        viewerInfoButton?.setAttribute('aria-pressed', 'false');
        viewerImage.removeAttribute('src');
        viewerImage.classList.remove('is-changing', 'is-missing');
        if (lastTrigger?.isConnected) lastTrigger.focus();
    });
    viewer?.addEventListener('click', (event) => {
        if (event.target === viewer) closeViewer();
    });
    viewer?.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeViewer();
    });
    viewer?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeViewer();
            return;
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            moveViewer(-1);
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            moveViewer(1);
        }
    });
    viewerImage?.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'touch') touchOrigin = { x: event.clientX, y: event.clientY };
    });
    viewerImage?.addEventListener('pointerup', (event) => {
        if (!touchOrigin) return;
        const deltaX = event.clientX - touchOrigin.x;
        const deltaY = event.clientY - touchOrigin.y;
        touchOrigin = null;
        if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY)) {
            moveViewer(deltaX < 0 ? 1 : -1);
        }
    });
    viewerImage?.addEventListener('pointercancel', () => { touchOrigin = null; });

    document.querySelector('#sound-toggle')?.addEventListener('click', (event) => {
        soundEnabled = !soundEnabled;
        event.currentTarget.textContent = `sound: ${soundEnabled ? 'on' : 'off'}`;
        event.currentTarget.setAttribute('aria-pressed', String(soundEnabled));
        try {
            sessionStorage.setItem('archive-sound', soundEnabled ? 'on' : 'off');
        } catch {
            soundEnabled = false;
            event.currentTarget.textContent = 'sound: off';
            event.currentTarget.setAttribute('aria-pressed', 'false');
        }
        if (soundEnabled) playTick();
    });

    const soundToggle = document.querySelector('#sound-toggle');
    if (soundToggle) {
        soundToggle.textContent = `sound: ${soundEnabled ? 'on' : 'off'}`;
        soundToggle.setAttribute('aria-pressed', String(soundEnabled));
    }

    document.querySelectorAll('#contact-link').forEach((link) => {
        link.href = galleryData?.contact || 'mailto:thisisacryforhelp.photography@gmail.com';
    });

    document.addEventListener('click', (event) => {
        const link = event.target.closest('a[href]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (link.target || link.hasAttribute('download')) return;
        const target = new URL(link.href, document.baseURI);
        if (target.origin !== window.location.origin || target.pathname === window.location.pathname) return;
        if (leavingPage) {
            event.preventDefault();
            return;
        }
        if (link.classList.contains('start-link') || link.closest('#collection-list')) {
            try {
                sessionStorage.setItem(storageKey, 'yes');
            } catch {
                // Collection pages remain available when session storage is blocked.
            }
            link.classList.add('is-leaving');
        }
        event.preventDefault();
        leavingPage = true;
        body.classList.add('page-leaving');
        window.setTimeout(() => window.location.assign(target.href), reducedMotion ? 0 : 150);
    });

    window.addEventListener('pageshow', (event) => {
        if (!event.persisted) return;
        if (page === 'home') initializeHomeTitle();
        leavingPage = false;
        document.querySelectorAll('.start-link.is-leaving').forEach((link) => link.classList.remove('is-leaving'));
        body.classList.remove('page-leaving', 'is-loading');
        body.classList.add('gallery-visible', 'is-ready');

        if (viewer?.open) viewer.close();
        if (!galleryData) {
            loadGallery();
            return;
        }
        if (galleryPage && photoGrid && currentPhotos.length && photoGrid.children.length === 0) {
            renderPhotos(currentPhotos);
        }
        if (page === 'collections' && collectionList && collectionList.children.length === 0) {
            renderCollections();
        }
    });

    async function loadGallery() {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(siteUrl('data/gallery.json'), { signal: controller.signal });
            if (!response.ok) throw new Error(`Gallery configuration returned ${response.status}`);
            galleryData = await response.json();
            if (!Array.isArray(galleryData.collections)) throw new Error('Gallery configuration has no collections array');
            document.querySelectorAll('.site-title').forEach((label) => {
                label.textContent = galleryData.siteTitle || 'this is a cry for help';
            });
            const pageLabel = page === 'collections'
                ? 'collections'
                : page === 'collection'
                    ? galleryData.collections.find((collection) => collection.id === body.dataset.collectionId)?.title || ''
                    : page === 'home' ? 'home' : '';
            document.querySelectorAll('.page-label').forEach((label) => {
                if (pageLabel) label.textContent = pageLabel;
            });

            document.querySelectorAll('#contact-link').forEach((link) => {
                link.href = galleryData.contact || 'mailto:thisisacryforhelp.photography@gmail.com';
            });

            if (page === 'collections') {
                renderCollections();
            } else if (galleryPage) {
                let collection;
                if (page === 'home') {
                    const images = galleryData.collections.flatMap((item) => item.images || []);
                    await renderPhotos(images);
                } else {
                    collection = galleryData.collections.find((item) => item.id === body.dataset.collectionId);
                    if (!collection) {
                        setStatus('collection unavailable', true);
                    } else {
                        document.querySelector('#collection-id').textContent = collection.title;
                        await renderPhotos(collection.images || []);
                        const ending = document.querySelector('#collection-ending');
                        if (ending && collection.images?.length) ending.hidden = false;
                    }
                }
            }
        } catch (error) {
            console.error('Gallery configuration could not be loaded:', error);
            setStatus('configuration unavailable', true);
        } finally {
            window.clearTimeout(timeout);
            await finishLoading();
        }
    }

    if (page !== 'landing') loadGallery();
})();
