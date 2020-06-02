const express = require('express');
const app = express();
const port = 3000;

app.get('/', (req, res) => res.send('Hello World!'));

app.listen(port, () => console.log(`Example app listening on port ${port}!`));

const { Builder, By, Key, until } = require('selenium-webdriver');

const clickWithMouse = async (driver, by) => {
	await driver.wait(until.elementLocated(by), 30000);
	const bt = driver.findElement(by);
	await driver.wait(until.elementIsVisible(
		bt
	), 30000);
	const actions = driver.actions();

	while (true) {
		try {
			await driver.wait(until.elementLocated(by), 100);
			await actions
				.move({ origin: bt })
				.click()
				.perform();
		} catch{
			break;
		}
	}
};


const clickElement = async (driver, by) => {
	await driver.wait(until.elementLocated(by), 30000);
	const bt = driver.findElement(by);
	await driver.wait(until.elementIsVisible(
		bt
	), 30000);
	bt.click();
};
const login = async (driver) => {
	await driver.wait(until.elementLocated(By.id('bitmeup.login.email')), 30000);
	await driver.wait(until.elementIsVisible(
		await driver.findElement(By.id('bitmeup.login.email'))
	), 30000);
	await driver.findElement(By.id('bitmeup.login.email')).sendKeys('vitor.ecomp@gmail.com');
	await driver.findElement(By.id('bitmeup.login.password')).sendKeys('----');

	await clickWithMouse(driver, By.xpath('//div[@class="login_button"]'));
	await clickWithMouse(driver, By.xpath('//span[text()="Sirius"]'));
};

(async function example() {
	let driver = await new Builder().forBrowser('firefox').build();
	console.log(await driver.getSession());
	await driver.get('https://w2-spaceinvasion.bitmeup.com/');
	await login(driver);

	// await driver.wait(until.titleIs('webdriver - Google Search'), 1000);
})();