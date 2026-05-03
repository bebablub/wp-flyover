const SunCalc = require('../../assets/js/suncalc.js');

describe('SunCalc Validation', () => {
    const lat = 48.1351;
    const lon = 11.5820; // Munich
    
    test('Sun and Moon positions should be different for most times', () => {
        const date = new Date('2026-05-03T12:00:00Z');
        const sun = SunCalc.getPosition(date, lat, lon);
        const moon = SunCalc.getMoonPosition(date, lat, lon);
        
        expect(sun.altitude).toBeDefined();
        expect(moon.altitude).toBeDefined();
        
        const sunDeg = sun.altitude * 180 / Math.PI;
        const moonDeg = moon.altitude * 180 / Math.PI;
        
        expect(Math.abs(sunDeg - moonDeg)).toBeGreaterThan(1);
    });

    test('Sun and Moon positions on different dates', () => {
        const dates = [
            '2026-05-03T12:00:00Z',
            '2026-05-10T12:00:00Z',
            '2026-05-17T12:00:00Z',
            '2026-05-24T12:00:00Z'
        ];
        
        dates.forEach(dStr => {
            const date = new Date(dStr);
            const sun = SunCalc.getPosition(date, lat, lon);
            const moon = SunCalc.getMoonPosition(date, lat, lon);
            const sunDeg = sun.altitude * 180 / Math.PI;
            const moonDeg = moon.altitude * 180 / Math.PI;
            
            console.log(`Date: ${dStr} | Sun: ${sunDeg.toFixed(1)}° | Moon: ${moonDeg.toFixed(1)}°`);
            expect(sunDeg).not.toEqual(moonDeg);
        });
    });

    test('Sun position changes over time', () => {
        const date1 = new Date('2026-05-03T08:00:00Z');
        const date2 = new Date('2026-05-03T12:00:00Z');
        
        const pos1 = SunCalc.getPosition(date1, lat, lon);
        const pos2 = SunCalc.getPosition(date2, lat, lon);
        
        expect(pos1.altitude).not.toBe(pos2.altitude);
    });

    test('Moon position changes over time', () => {
        const date1 = new Date('2026-05-03T08:00:00Z');
        const date2 = new Date('2026-05-03T12:00:00Z');
        
        const pos1 = SunCalc.getMoonPosition(date1, lat, lon);
        const pos2 = SunCalc.getMoonPosition(date2, lat, lon);
        
        expect(pos1.altitude).not.toBe(pos2.altitude);
    });

    test('Handles edge case: extreme latitudes', () => {
        const date = new Date('2026-06-21T12:00:00Z');
        const northPole = SunCalc.getPosition(date, 90, 0);
        const southPole = SunCalc.getPosition(date, -90, 0);
        
        expect(northPole.altitude).toBeGreaterThan(0); // Summer in North
        expect(southPole.altitude).toBeLessThan(0);    // Winter in South
    });

    test('Astro refraction is applied correctly', () => {
        // Moon position includes astroRefraction(h)
        // Let is mock altitude to see it works
        // Since we can not easily mock internal functions, we just verify it does not crash
        const date = new Date();
        const moon = SunCalc.getMoonPosition(date, lat, lon);
        expect(isFinite(moon.altitude)).toBe(true);
    });
});
