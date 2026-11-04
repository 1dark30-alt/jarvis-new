import { NextRequest, NextResponse } from 'next/server';

const W = (file: string) => `/assets/Weather/${file}`;

const WMO_LABELS: Record<number, { label: string; icon: string }> = {
  0:  { label: 'Clear',           icon: W('Clear.png')         },
  1:  { label: 'Mostly Clear',    icon: W('Mostly Clear.png')  },
  2:  { label: 'Partly Cloudy',   icon: W('Partly Cloudy.png') },
  3:  { label: 'Overcast',        icon: W('Cloudy.png')        },
  45: { label: 'Foggy',           icon: W('Cloudy.png')        },
  48: { label: 'Icing Fog',       icon: W('Cloudy.png')        },
  51: { label: 'Light Drizzle',   icon: W('Light Drizzle.png') },
  53: { label: 'Drizzle',         icon: W('Light Drizzle.png') },
  55: { label: 'Heavy Drizzle',   icon: W('Heavy Rain.png')    },
  61: { label: 'Light Rain',      icon: W('Light Drizzle.png') },
  63: { label: 'Rain',            icon: W('Heavy Rain.png')    },
  65: { label: 'Heavy Rain',      icon: W('Heavy Rain.png')    },
  71: { label: 'Light Snow',      icon: W('Light Snow.png')    },
  73: { label: 'Snow',            icon: W('Heavy Snow.png')    },
  75: { label: 'Heavy Snow',      icon: W('Heavy Snow.png')    },
  80: { label: 'Showers',         icon: W('Light Drizzle.png') },
  81: { label: 'Rain Showers',    icon: W('Heavy Rain.png')    },
  82: { label: 'Violent Showers', icon: W('Thunderstorm.png')  },
  95: { label: 'Thunderstorm',    icon: W('Thunderstorm.png')  },
  99: { label: 'Hail Storm',      icon: W('Thunderstorm.png')  },
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');

  if (!lat || !lon) {
    return NextResponse.json({ error: 'lat and lon are required' }, { status: 400 });
  }

  try {
    const [weatherRes, geoRes] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph&daily=temperature_2m_max,temperature_2m_min&timezone=auto`),
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
        headers: { 'User-Agent': 'JarvisClient/1.0' },
      }),
    ]);

    const weatherData = await weatherRes.json() as {
      current_weather: { temperature: number; windspeed: number; weathercode: number; is_day: number };
      daily?: { temperature_2m_max: number[]; temperature_2m_min: number[] };
    };

    const geoData = await geoRes.json() as {
      address?: { city?: string; town?: string; village?: string; state?: string };
    };

    const cw   = weatherData.current_weather;
    const code = cw.weathercode as keyof typeof WMO_LABELS;
    const meta = WMO_LABELS[code] ?? { label: 'Unknown', icon: W('Cloudy.png') };
    const city = geoData.address?.city ?? geoData.address?.town ?? geoData.address?.village ?? 'Unknown';
    const state = geoData.address?.state ?? '';

    return NextResponse.json({
      temperature: Math.round(cw.temperature),
      windspeed:   Math.round(cw.windspeed),
      condition:   meta.label,
      icon:        meta.icon,
      isDay:       cw.is_day === 1,
      city,
      state,
      high: weatherData.daily?.temperature_2m_max?.[0] != null ? Math.round(weatherData.daily.temperature_2m_max[0]) : null,
      low:  weatherData.daily?.temperature_2m_min?.[0] != null ? Math.round(weatherData.daily.temperature_2m_min[0]) : null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
