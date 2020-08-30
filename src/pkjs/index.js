const Clay = require('pebble-clay');
const clayConfig = require('./config.json');
const customClay = require('./custom-clay');
const clay = new Clay(clayConfig, customClay);

let tempEnabled;
let tempUnits;
let tempFeelsLike;
let weatherProvider;
let weatherAPIKey;

function xhrRequest(url) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		const type = "GET";
		xhr.onload = function() { resolve(xhr.response); };
		xhr.onerror = reject;
		xhr.open(type, url);
		xhr.send();
	});
};

function requestDarksky(lat, lon) {
	const units = (tempUnits === 'c') ? 'si' : 'us';
	const url = `https://api.darksky.net/forecast/${weatherAPIKey}/${lat},${lon}?units=${units}&exclude=minutely,hourly,alerts,flags`;

	return xhrRequest(url).then(responseText => {
		const json = JSON.parse(responseText);
		let now, min, max;
		if (tempFeelsLike) {
			now = json.currently.apparentTemperature;
			min = json.daily.data[0].apparentTemperatureLow;
			max = json.daily.data[0].apparentTemperatureHigh;
		} else {
			now = json.currently.temperature;
			min = json.daily.data[0].temperatureLow;
			max = json.daily.data[0].temperatureHigh;
		}
		return [now, min, max];
	});
}

function requestClimacell(lat, lon) {
	const units = (tempUnits === 'c') ? 'si' : 'us';
	const tempField = tempFeelsLike ? 'feels_like' : 'temp';
	const query = `lat=${lat}&lon=${lon}&unit_system=${units}&fields=${tempField}&apikey=${weatherAPIKey}`;

	const nowEndpoint = `https://api.climacell.co/v3/weather/realtime?${query}`;
	const nowRequest = xhrRequest(nowEndpoint).then(responseText => {
		const json = JSON.parse(responseText);
		return json[tempField].value;
	});

	const dailyEndpoint = `https://api.climacell.co/v3/weather/forecast/daily?start_time=now&${query}`;
	const dailyRequest = xhrRequest(dailyEndpoint).then(responseText => {
		const json = JSON.parse(responseText);
		const min = json[0][tempField][0].min.value;
		const max = json[0][tempField][1].max.value;
		return [min, max];
	});

	return Promise.all([nowRequest, dailyRequest]).then(results => {
		const now = results[0]
		const minMax = results[1];
		return [now, minMax[0], minMax[1]];
	});
}

function requestOwm(lat, lon) {
	const units = (tempUnits === 'c') ? 'metric' : 'imperial';
	const url = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&units=${units}&appid=${weatherAPIKey}&exclude=hourly,minutely`;

	return xhrRequest(url).then(responseText => {
		const json = JSON.parse(responseText);
		let now, min, max;
		if (tempFeelsLike) {
			now = json.current.feels_like;
		} else {
			now = json.current.temp;
		}
		min = json.daily[0].temp.min;
		max = json.daily[0].temp.max;
		return [now, min, max];
	});
}

function locationSuccess(pos) {
	console.log('Retrieving weather');
	if (weatherAPIKey) {
		const lat = pos.coords.latitude;
		const lon = pos.coords.longitude;
		let weatherPromise;
		switch (weatherProvider) {
			case 'darksky':
				weatherPromise = requestDarksky(lat, lon);
				break;
			case 'climacell':
				weatherPromise = requestClimacell(lat, lon);
				break;
			case 'owm':
				weatherPromise = requestOwm(lat, lon);
				break;
		}

		weatherPromise.then(nowMinMaxTuple => {

			let now, min, max;
			[now, min, max] = nowMinMaxTuple.map(val => Math.round(val));

			console.log(`Current temp: ${now}; min: ${min}; max: ${max}`);

			// Assemble dictionary using our keys
			const dictionary = {
				'TEMP_NOW': now,
				'TEMP_MIN': min,
				'TEMP_MAX': max,
			};

			// Send to Pebble
			Pebble.sendAppMessage(dictionary,
				function(e) {
					console.log('Weather info sent to Pebble successfully!');
				},
				function(e) {
					console.log('Error sending weather info to Pebble!');
				}
			);
		});
	}
}

function locationError(err) {
	console.log('Error requesting location!');
}

function getWeather() {
	if (tempEnabled) {
		navigator.geolocation.getCurrentPosition(
			locationSuccess,
			locationError,
			{timeout: 15000, maximumAge: 60000}
		);
	}
}

Pebble.addEventListener('webviewclosed', function(e) {
	const claySettings = clay.getSettings(e.response, false);

	const tempUnitsChanged = (tempUnits !== claySettings['TEMP_UNIT'].value);

	tempEnabled = claySettings['TEMP_ENABLED'].value;
	tempUnits = claySettings['TEMP_UNIT'].value;
	tempFeelsLike = claySettings['TEMP_FEELS_LIKE'].value;
	weatherProvider = claySettings['WEATHER_PROVIDER'].value;
	weatherAPIKey = claySettings['WEATHER_API_KEY'].value;

	if (claySettings['UPDATE_WEATHER_ON_CONFIG'].value || tempUnitsChanged) {
		getWeather();
	}
});

// Listen for when the watchface is opened
Pebble.addEventListener('ready', 
	function(e) {
		console.log('PebbleKit JS ready!');

		if (localStorage.getItem('clay-settings') !== null) {
			const localStorageSettings = JSON.parse(localStorage.getItem('clay-settings'));
			tempEnabled = localStorageSettings['TEMP_ENABLED'];
			tempUnits = localStorageSettings['TEMP_UNIT'];
			tempFeelsLike = localStorageSettings['TEMP_FEELS_LIKE'];
			weatherProvider = localStorageSettings['WEATHER_PROVIDER'];
			weatherAPIKey = localStorageSettings['WEATHER_API_KEY'];
		}
	}
);

Pebble.addEventListener('appmessage', function(e) {
	getWeather();
});
