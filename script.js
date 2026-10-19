document.addEventListener('DOMContentLoaded', () => {
    const locationPreset = document.getElementById('location-preset');
    const customCoords = document.getElementById('custom-coords');
    const latInput = document.getElementById('lat-input');
    const lonInput = document.getElementById('lon-input');
    const dayOfYearInput = document.getElementById('day-of-year');
    const dateDisplay = document.getElementById('date-display');
    const timeSlider = document.getElementById('time-slider');
    const timeDisplay = document.getElementById('time-display');
    const playBtn = document.getElementById('play-btn');
    const resetBtn = document.getElementById('reset-btn');
    
    const statElevation = document.getElementById('stat-elevation');
    const statPhase = document.getElementById('stat-phase');
    const currentPhaseBadge = document.getElementById('current-phase-badge');
    const timelineGrid = document.getElementById('timeline-grid');
    
    const canvas = document.getElementById('sky-canvas');
    const ctx = canvas.getContext('2d');

    let isPlaying = false;
    let animationId = null;

    // Month names and days for date calculator
    const months = [
        { name: 'January', days: 31 },
        { name: 'February', days: 28 },
        { name: 'March', days: 31 },
        { name: 'April', days: 30 },
        { name: 'May', days: 31 },
        { name: 'June', days: 30 },
        { name: 'July', days: 31 },
        { name: 'August', days: 31 },
        { name: 'September', days: 30 },
        { name: 'October', days: 31 },
        { name: 'November', days: 30 },
        { name: 'December', days: 31 }
    ];

    function getMonthDay(dayNum) {
        let accumulated = 0;
        for (let i = 0; i < months.length; i++) {
            if (dayNum <= accumulated + months[i].days) {
                return { month: months[i].name, day: dayNum - accumulated };
            }
            accumulated += months[i].days;
        }
        return { month: 'December', day: 31 };
    }

    function getLatLon() {
        if (locationPreset.value === 'custom') {
            return {
                lat: parseFloat(latInput.value) || 0,
                lon: parseFloat(lonInput.value) || 0
            };
        } else {
            const parts = locationPreset.value.split(',');
            return {
                lat: parseFloat(parts[0]),
                lon: parseFloat(parts[1])
            };
        }
    }

    function formatTime(minutesTotal) {
        let mins = Math.round(minutesTotal);
        if (mins < 0) mins += 1440;
        if (mins >= 1440) mins %= 1440;
        
        const hours = Math.floor(mins / 60);
        const minutes = mins % 60;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 === 0 ? 12 : hours % 12;
        const displayMins = minutes < 10 ? '0' + minutes : minutes;
        return `${displayHours}:${displayMins} ${ampm}`;
    }

    // Astronomical approximation formulas
    function calculateSolarData(lat, lon, dayOfYear, timeMinutes) {
        // Declination of sun (approximate formula in radians)
        const declination = 23.45 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81)) * (Math.PI / 180);
        const latRad = lat * (Math.PI / 180);
        
        // Solar time offset based on longitude and minutes from UTC midnight
        // timeMinutes is UTC time (0 to 1440)
        const solarTimeMin = (timeMinutes + (lon * 4)) % 1440;
        const hourAngle = ((solarTimeMin / 4) - 180) * (Math.PI / 180);
        
        // Elevation angle
        const sinElevation = Math.sin(latRad) * Math.sin(declination) + 
                             Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
        const elevationRad = Math.asin(Math.max(-1, Math.min(1, sinElevation)));
        const elevationDeg = elevationRad * (180 / Math.PI);
        
        // Azimuth angle calculation
        const cosAzimuth = (Math.sin(declination) - Math.sin(latRad) * sinElevation) / 
                           (Math.cos(latRad) * Math.cos(elevationRad) + 0.0001);
        let azimuthDeg = Math.acos(Math.max(-1, Math.min(1, cosAzimuth))) * (180 / Math.PI);
        if (Math.sin(hourAngle) > 0) {
            azimuthDeg = 360 - azimuthDeg;
        }

        return {
            elevation: elevationDeg,
            azimuth: azimuthDeg,
            declination: declination * (180 / Math.PI)
        };
    }

    function getTwilightPhase(elevation) {
        if (elevation > 0) return { name: 'Daylight', badge: '☀️ Daylight' };
        if (elevation >= -0.833) return { name: 'Sunset / Sunrise', badge: '🌅 Golden Hour' };
        if (elevation > -6) return { name: 'Civil Twilight', badge: '🌇 Civil Twilight' };
        if (elevation > -12) return { name: 'Nautical Twilight', badge: '🌆 Nautical Twilight' };
        if (elevation > -18) return { name: 'Astronomical Twilight', badge: '🌃 Astronomical' };
        return { name: 'Night', badge: '✨ Night Sky' };
    }

    // Calculate key event times for the day by scanning 1440 minutes
    function calculateKeyEvents(lat, lon, dayOfYear) {
        let events = { sunrise: null, sunset: null, civilStart: null, civilEnd: null, nauticalStart: null, nauticalEnd: null };
        
        let prevElev = null;
        for (let m = 0; m <= 1440; m += 5) {
            const data = calculateSolarData(lat, lon, dayOfYear, m);
            const elev = data.elevation;
            
            if (prevElev !== null) {
                // Sunrise / Sunset (-0.833° accounts for refraction & solar radius)
                if (prevElev < -0.833 && elev >= -0.833 && !events.sunrise) events.sunrise = m;
                if (prevElev >= -0.833 && elev < -0.833 && !events.sunset) events.sunset = m;
                
                // Civil Twilight (-6°)
                if (prevElev < -6 && elev >= -6 && !events.civilStart) events.civilStart = m;
                if (prevElev >= -6 && elev < -6 && !events.civilEnd) events.civilEnd = m;

                // Nautical Twilight (-12°)
                if (prevElev < -12 && elev >= -12 && !events.nauticalStart) events.nauticalStart = m;
                if (prevElev >= -12 && elev < -12 && !events.nauticalEnd) events.nauticalEnd = m;
            }
            prevElev = elev;
        }
        return events;
    }

    // Render sky canvas based on elevation
    function renderSky(elevation, azimuth, dayOfYear) {
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.clearRect(0, 0, width, height);

        // Sky color gradient calculation based on solar elevation
        let topColor, midColor, horizonColor;
        
        if (elevation > 10) {
            // Bright daylight
            topColor = '#1e3a8a';
            midColor = '#3b82f6';
            horizonColor = '#93c5fd';
        } else if (elevation > 0) {
            // Low sun / morning or late afternoon
            topColor = '#1e293b';
            midColor = '#ea580c';
            horizonColor = '#fde047';
        } else if (elevation >= -2) {
            // Golden hour / Sunset transition
            topColor = '#0f172a';
            midColor = '#9333ea';
            horizonColor = '#f97316';
        } else if (elevation >= -6) {
            // Civil twilight
            topColor = '#090d16';
            midColor = '#1e1b4b';
            horizonColor = '#c2410c';
        } else if (elevation >= -12) {
            // Nautical twilight
            topColor = '#05070c';
            midColor = '#0f172a';
            horizonColor = '#312e81';
        } else if (elevation >= -18) {
            // Astronomical twilight
            topColor = '#020408';
            midColor = '#070a14';
            horizonColor = '#1e1b4b';
        } else {
            // Deep night
            topColor = '#010205';
            midColor = '#03050a';
            horizonColor = '#0a0f1d';
        }

        // Draw background gradient
        const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.8);
        skyGrad.addColorStop(0, topColor);
        skyGrad.addColorStop(0.5, midColor);
        skyGrad.addColorStop(1, horizonColor);
        
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, width, height);

        // Draw stars if dark
        if (elevation < -2) {
            const opacity = Math.min(1, (-elevation - 2) / 10);
            ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.8})`;
            // Pseudo-random deterministic star field based on dayOfYear
            let seed = dayOfYear * 997;
            for (let i = 0; i < 80; i++) {
                seed = (seed * 9301 + 49297) % 233280;
                const sx = (seed / 233280) * width;
                seed = (seed * 9301 + 49297) % 233280;
                const sy = (seed / 233280) * (height * 0.7);
                const radius = (seed % 3 === 0) ? 1.5 : 1;
                ctx.beginPath();
                ctx.arc(sx, sy, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Draw Sun or Moon if above horizon
        // Map azimuth and elevation to canvas coordinates
        const sunX = width / 2 + (azimuth > 180 ? azimuth - 360 : azimuth) * (width / 180);
        const sunY = (height * 0.8) - (elevation / 90) * (height * 0.7);

        if (elevation > -15 && sunX >= -50 && sunX <= width + 50) {
            // Sun glow
            const sunGrad = ctx.createRadialGradient(sunX, sunY, 5, sunX, sunY, 60);
            sunGrad.addColorStop(0, 'rgba(255, 255, 200, 0.9)');
            sunGrad.addColorStop(0.5, 'rgba(255, 165, 0, 0.3)');
            sunGrad.addColorStop(1, 'rgba(255, 100, 0, 0)');
            
            ctx.fillStyle = sunGrad;
            ctx.beginPath();
            ctx.arc(sunX, sunY, 60, 0, Math.PI * 2);
            ctx.fill();

            // Sun disc
            ctx.fillStyle = elevation < 2 ? '#ff4500' : '#fef08a';
            ctx.beginPath();
            ctx.arc(sunX, sunY, 12, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ground landscape silhouette
        ctx.fillStyle = '#090b10';
        ctx.beginPath();
        ctx.moveTo(0, height * 0.8);
        // Gentle rolling hills
        for (let x = 0; x <= width; x += 20) {
            const y = (height * 0.8) + Math.sin(x * 0.01) * 15 + Math.cos(x * 0.005) * 25;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fill();
    }

    function updateSimulation() {
        const loc = getLatLon();
        const dayNum = parseInt(dayOfYearInput.value);
        const timeMinutes = parseInt(timeSlider.value);
        
        const { month, day } = getMonthDay(dayNum);
        dateDisplay.textContent = `${month} ${day} (Day ${dayNum})`;
        timeDisplay.textContent = formatTime(timeMinutes);
        
        const solarData = calculateSolarData(loc.lat, loc.lon, dayNum, timeMinutes);
        const phaseInfo = getTwilightPhase(solarData.elevation);
        
        statElevation.textContent = `${solarData.elevation.toFixed(1)}°`;
        statPhase.textContent = phaseInfo.name;
        currentPhaseBadge.textContent = phaseInfo.badge;
        
        renderSky(solarData.elevation, solarData.azimuth, dayNum);
        updateTimeline(loc.lat, loc.lon, dayNum);
    }

    function updateTimeline(lat, lon, dayNum) {
        const events = calculateKeyEvents(lat, lon, dayNum);
        
        const eventList = [
            { title: 'Nautical Dawn', time: events.nauticalStart },
            { title: 'Civil Dawn', time: events.civilStart },
            { title: 'Sunrise', time: events.sunrise },
            { title: 'Sunset', time: events.sunset },
            { title: 'Civil Dusk', time: events.civilEnd },
            { title: 'Nautical Dusk', time: events.nauticalEnd }
        ];

        timelineGrid.innerHTML = '';
        eventList.forEach(ev => {
            const div = document.createElement('div');
            div.className = 'timeline-item';
            div.innerHTML = `
                <span class="timeline-item-title">${ev.title}</span>
                <span class="timeline-item-time">${ev.time !== null ? formatTime(ev.time) : 'N/A (Polar)'}</span>
            `;
            timelineGrid.appendChild(div);
        });
    }

    // Event Listeners
    locationPreset.addEventListener('change', () => {
        if (locationPreset.value === 'custom') {
            customCoords.classList.remove('hidden');
        } else {
            customCoords.classList.add('hidden');
        }
        updateSimulation();
    });

    latInput.addEventListener('input', updateSimulation);
    lonInput.addEventListener('input', updateSimulation);
    dayOfYearInput.addEventListener('input', updateSimulation);
    timeSlider.addEventListener('input', updateSimulation);

    resetBtn.addEventListener('click', () => {
        timeSlider.value = 720; // 12:00 PM UTC
        dayOfYearInput.value = 172; // Summer solstice approx
        updateSimulation();
    });

    playBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        if (isPlaying) {
            playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
            animateTime();
        } else {
            playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play';
            cancelAnimationFrame(animationId);
        }
    });

    function animateTime() {
        if (!isPlaying) return;
        let currentVal = parseInt(timeSlider.value);
        currentVal = (currentVal + 5) % 1440;
        timeSlider.value = currentVal;
        updateSimulation();
        animationId = requestAnimationFrame(() => {
            setTimeout(animateTime, 60);
        });
    }

    // Initial render
    updateSimulation();
});
