from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains


driver = webdriver.Firefox()
driver.get('https://spaceinvasion.bitmeup.com/')
print(driver.title)


def sendKeysWithWait(driver, id, text, time = 30000):
    print(f'waiting on {id}')
    locator = (By.ID, id)

    text_box = WebDriverWait(driver, time).until(
        EC.visibility_of_element_located(locator)
    )

    text_box.send_keys(text)

def click_with_mouse(driver, xpath, time = 30000):
    print(f'waiting on {xpath}')
    
    locator = (By.XPATH, xpath)
    WebDriverWait(driver, time).until(EC.presence_of_element_located(locator))
    element = WebDriverWait(driver, time).until(EC.element_to_be_clickable(locator))
    actions = ActionChains(driver)

    print(f'clicking on {xpath}')
    for i in range(10000):
        try:
            WebDriverWait(driver, 0.1).until(EC.element_to_be_clickable(locator))
            actions.move_to_element(element).click().perform()
            break  # Exit the loop after successful click
        except:
            pass

def clickWithWaitXpath(driver, xpath, time = 30000):
    print(f'waiting on {xpath}')
    locator = (By.XPATH, xpath)
    button = WebDriverWait(driver, time).until(
        EC.element_to_be_clickable(locator)
    )

    print(f'clicking on {xpath}')
    button.click()
    
def verifyElementByXpath(driver, xpath, time = 30000):
    print(f'waiting on {xpath}')
    locator = (By.XPATH, xpath)
    try:
        WebDriverWait(driver, time).until(EC.presence_of_element_located(locator))
        return True
    except:
        return False


sendKeysWithWait(driver, "bitmeup.login.email", "vieiravitorx86@gmail.com")
sendKeysWithWait(driver, "bitmeup.login.password", "noFuck10")
while(not verifyElementByXpath(driver, '//span[text()="Sirius"]', 10)):
    click_with_mouse(driver, '//div[@class="login_button"]')
    
while(verifyElementByXpath(driver, '//span[text()="Sirius"]', 1)):
    click_with_mouse(driver, '//span[text()="Sirius"]')
    verifyElementByXpath(driver, '//span[text()="Center"]', 10)

click_with_mouse(driver, '//span[text()="Galaxy"]')

# driver.quit()