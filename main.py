"""
cron: 0 */6 * * *
new Env("Linux.Do 签到")
"""
import os
import random
import time
import functools
import sys
import requests
from loguru import logger
from playwright.sync_api import sync_playwright
from tabulate import tabulate
#from dotenv import load_dotenv

#load_dotenv()

def retry_decorator(retries=3):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == retries - 1:  # 最后一次尝试
                        logger.error(f"函数 {func.__name__} 最终执行失败: {str(e)}")
                    logger.warning(f"函数 {func.__name__} 第 {attempt + 1}/{retries} 次尝试失败: {str(e)}")
                    time.sleep(1)
            return None

        return wrapper

    return decorator


os.environ.pop("DISPLAY", None)
os.environ.pop("DYLD_LIBRARY_PATH", None)

# 读取并解析多账户凭据
raw_usernames = os.environ.get("LINUXDO_USERNAME")
raw_passwords = os.environ.get("LINUXDO_PASSWORD")

if not raw_usernames or not raw_passwords:
    logger.error("请设置 LINUXDO_USERNAME 和 LINUXDO_PASSWORD 环境变量。多账户请用 ; 分隔。")
    sys.exit(1)

usernames = [u.strip() for u in raw_usernames.split(';') if u.strip()]
passwords = [p.strip() for p in raw_passwords.split(';') if p.strip()]

if len(usernames) != len(passwords):
    logger.error(f"用户名数量 ({len(usernames)}) 与密码数量 ({len(passwords)}) 不匹配。请检查环境变量。")
    sys.exit(1)

logger.info(f"检测到 {len(usernames)} 个账户。")

GOTIFY_URL = os.environ.get("GOTIFY_URL")
GOTIFY_TOKEN = os.environ.get("GOTIFY_TOKEN")

HOME_URL = "https://linux.do/"
LOGIN_URL = "https://linux.do/login"


class LinuxDoBrowser:
    def __init__(self, username, password) -> None:
        self.username = username
        self.password = password
        self.pw = sync_playwright().start()
        self.browser = self.pw.firefox.launch(headless=True, timeout=30000)
        # 定义一个 Windows Firefox 的 User-Agent 字符串
        windows_user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36" # 你可以根据需要更新版本号
        self.context = self.browser.new_context(
            user_agent=windows_user_agent
        )
        self.page = self.context.new_page()
        self.page.goto(HOME_URL)

    def login(self):
        logger.info(f"账户 [{self.username}] 开始登录")
        # self.page.click(".login-button .d-button-label")
        self.page.goto(LOGIN_URL)
        time.sleep(2)
        self.page.fill("#login-account-name", self.username)
        time.sleep(2)
        self.page.fill("#login-account-password", self.password)
        time.sleep(2)
        self.page.click("#login-button")
        time.sleep(10)
        user_ele = self.page.query_selector("#current-user")
        if not user_ele:
            logger.error(f"账户 [{self.username}] 登录失败")
            return False
        else:
            logger.info(f"账户 [{self.username}] 登录成功")
            return True

    def click_topic(self):
        topic_list = self.page.query_selector_all("#list-area .title")
        logger.info(f"发现 {len(topic_list)} 个主题帖")
        for topic in topic_list:
            self.click_one_topic(topic.get_attribute("href"))

    @retry_decorator()
    def click_one_topic(self, topic_url):
        page = self.context.new_page()
        page.goto(HOME_URL + topic_url)
        # 随机点赞，概率降低到 15%
        if random.random() < 0.15:
            self.click_like(page)
        self.browse_post(page)
        page.close()

    def browse_post(self, page):
        prev_url = None
        # 开始自动滚动，最多滚动10次
        for _ in range(10):
            # 随机滚动一段距离
            scroll_distance = random.randint(550, 650)  # 随机滚动 550-650 像素
            logger.info(f"向下滚动 {scroll_distance} 像素...")
            page.evaluate(f"window.scrollBy(0, {scroll_distance})")
            logger.info(f"已加载页面: {page.url}")

            if random.random() < 0.03:  # 33 * 4 = 132
                logger.success("随机退出浏览")
                break

            # 检查是否到达页面底部
            at_bottom = page.evaluate("window.scrollY + window.innerHeight >= document.body.scrollHeight")
            current_url = page.url
            if current_url != prev_url:
                prev_url = current_url
            elif at_bottom and prev_url == current_url:
                logger.success("已到达页面底部，退出浏览")
                break

            # 动态随机等待
            wait_time = random.uniform(2, 5)  # 随机等待 2-5 秒
            logger.info(f"等待 {wait_time:.2f} 秒...")
            time.sleep(wait_time)

    def run(self):
        if not self.login():
            logger.error("登录失败，程序终止")
            sys.exit(1)  # 使用非零退出码终止整个程序
        self.click_topic() # 先浏览帖子
        self.reply_to_random_topic() # 再尝试回复一次
        self.print_connect_info()
        self.send_gotify_notification()

    def click_like(self, page):
        try:
            # 专门查找未点赞的按钮
            like_button = page.locator('.discourse-reactions-reaction-button[title="点赞此帖子"]').first
            if like_button:
                logger.info("找到未点赞的帖子，准备点赞")
                like_button.click()
                logger.info("点赞成功")
                time.sleep(random.uniform(1, 2))
            else:
                logger.info("帖子可能已经点过赞了")
        except Exception as e:
            logger.error(f"点赞失败: {str(e)}")

    @retry_decorator()
    def reply_to_random_topic(self):
        logger.info("开始尝试随机回复一个帖子")
        page = self.context.new_page()
        try:
            page.goto(HOME_URL)
            time.sleep(3) # 等待页面加载
            topic_elements = page.query_selector_all("#list-area .title")
            if not topic_elements:
                logger.warning("在首页未找到任何主题帖，无法执行回复操作")
                page.close()
                return

            topic_links = [topic.get_attribute("href") for topic in topic_elements]
            target_topic_url = random.choice(topic_links)
            full_topic_url = HOME_URL + target_topic_url
            logger.info(f"选择帖子进行回复: {full_topic_url}")

            page.goto(full_topic_url)
            time.sleep(random.uniform(3, 5)) # 等待帖子页面加载

            # 寻找主要的回复按钮 (可能需要调整选择器)
            reply_button_selector = 'button#reply-button, button.create.reply'
            reply_button = page.locator(reply_button_selector).first
            if not reply_button.is_visible():
                 # 尝试滚动到页面底部查找回复按钮
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                time.sleep(2)
                reply_button = page.locator(reply_button_selector).first

            if reply_button.is_visible():
                logger.info("找到回复按钮，准备点击")
                reply_button.click()
                time.sleep(random.uniform(2, 4)) # 等待编辑器加载

                # 定位回复输入框 (可能需要调整选择器)
                textarea_selector = 'textarea.d-editor-input'
                textarea = page.locator(textarea_selector).first
                replies = ["感谢分享！", "mark！", "我就看看！", "我静悄悄走来，静悄悄地走"]
                reply_content = random.choice(replies)
                logger.info(f"准备回复内容: {reply_content}")
                textarea.fill(reply_content)
                time.sleep(random.uniform(1, 3))

                # 定位提交回复按钮 (可能需要调整选择器)
                submit_button_selector = 'button.btn.btn-primary.create'
                submit_button = page.locator(submit_button_selector).first
                submit_button.click()
                logger.success(f"回复成功: {reply_content}")
                time.sleep(random.uniform(3, 5)) # 等待提交完成

            else:
                logger.warning("未找到回复按钮，可能帖子不允许回复或页面结构变化")

        except Exception as e:
            logger.error(f"回复帖子时发生错误: {str(e)}")
        finally:
            page.close()

    def print_connect_info(self):
        logger.info("获取连接信息")
        page = self.context.new_page()
        page.goto("https://connect.linux.do/")
        rows = page.query_selector_all("table tr")

        info = []

        for row in rows:
            cells = row.query_selector_all("td")
            if len(cells) >= 3:
                project = cells[0].text_content().strip()
                current = cells[1].text_content().strip()
                requirement = cells[2].text_content().strip()
                info.append([project, current, requirement])

        print("--------------Connect Info-----------------")
        print(tabulate(info, headers=["项目", "当前", "要求"], tablefmt="pretty"))

        page.close()

    def send_gotify_notification(self):
        """发送消息到Gotify"""
        if GOTIFY_URL and GOTIFY_TOKEN:
            try:
                response = requests.post(
                    f"{GOTIFY_URL}/message",
                    params={"token": GOTIFY_TOKEN},
                    json={
                        "title": "LINUX DO",
                        "message": f"✅每日签到成功完成",
                        "priority": 1
                    },
                    timeout=10
                )
                response.raise_for_status()
                logger.success("消息已推送至Gotify")
            except Exception as e:
                logger.error(f"Gotify推送失败: {str(e)}")
        else:
            logger.info("未配置Gotify环境变量，跳过通知发送")


if __name__ == "__main__":
    total_accounts = len(usernames)
    logger.info(f"共找到 {total_accounts} 个账户，开始执行任务...")

    for i, (username, password) in enumerate(zip(usernames, passwords), 1):
        logger.info(f"--- 开始处理第 {i}/{total_accounts} 个账户: {username} ---")
        try:
            l = LinuxDoBrowser(username, password)
            l.run()
            logger.info(f"--- 账户 {username} 处理完成 ---")
        except Exception as e:
            logger.error(f"处理账户 {username} 时发生严重错误: {e}")
            logger.exception("详细错误信息:") # 打印堆栈跟踪
        finally:
            # 确保浏览器资源被释放，即使出错
            try:
                l.browser.close() # 关闭浏览器
                l.pw.stop() # 停止playwright
            except Exception as close_err:
                logger.warning(f"关闭账户 {username} 的浏览器资源时出错: {close_err}")
            # 在账户之间添加短暂延时，可选
            if i < total_accounts:
                delay = random.uniform(30, 60)
                logger.info(f"等待 {delay:.2f} 秒后处理下一个账户...")
                time.sleep(delay)

    logger.info("所有账户处理完毕。")
