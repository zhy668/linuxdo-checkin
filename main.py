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
import platform
from loguru import logger
from DrissionPage import ChromiumPage, ChromiumOptions
from tabulate import tabulate
from dotenv import load_dotenv

load_dotenv()

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


def setup_drission_browser(headless=True):
    """设置DrissionPage浏览器配置，适配GitHub Actions环境"""
    if platform.system().lower() == 'windows':
        verify_text = '确认您是真人'
    else:
        verify_text = 'Verify you are human'

    co = ChromiumOptions()

    # GitHub Actions环境优化配置
    co.headless(headless)  # 默认无头模式
    co.incognito(True)  # 无痕隐身模式
    co.set_argument('--no-sandbox')  # GitHub Actions必需
    co.set_argument('--disable-gpu')  # GitHub Actions必需
    co.set_argument('--disable-dev-shm-usage')  # GitHub Actions必需
    co.set_argument('--disable-extensions')
    co.set_argument('--disable-web-security')
    co.set_argument('--disable-features=VizDisplayCompositor')
    co.set_argument('--disable-blink-features=AutomationControlled')
    co.set_argument('--disable-plugins')
    co.set_argument('--disable-images')  # 禁用图片加载提高速度
    co.set_argument('--disable-background-timer-throttling')
    co.set_argument('--disable-backgrounding-occluded-windows')
    co.set_argument('--disable-renderer-backgrounding')
    co.set_argument('--disable-background-networking')
    co.set_argument('--single-process')  # GitHub Actions单进程模式

    # 设置用户代理
    co.set_user_agent(user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')

    # 设置随机端口避免冲突
    port = random.randint(9000, 9999)
    co.set_local_port(port)

    return co, verify_text


def cleanup_drission_processes():
    """清理可能存在的DrissionPage进程"""
    try:
        import psutil
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                if proc.info['name'] and 'chrome' in proc.info['name'].lower():
                    cmdline = proc.info['cmdline']
                    if cmdline and any('--remote-debugging-port' in arg for arg in cmdline):
                        logger.info(f"终止DrissionPage相关进程: {proc.info['pid']}")
                        proc.terminate()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except ImportError:
        logger.warning("psutil未安装，无法清理进程")
    except Exception as e:
        logger.warning(f"清理进程时出错: {str(e)}")





class LinuxDoBrowser:
    def __init__(self, username, password, headless=True) -> None:
        self.username = username
        self.password = password
        self.headless = headless

        # 只使用DrissionPage处理Cloudflare
        logger.info("清理可能存在的DrissionPage进程...")
        cleanup_drission_processes()
        time.sleep(2)  # 等待进程清理完成

        co, self.verify_text = setup_drission_browser(headless)
        self.browser = ChromiumPage(co)
        try:
            self.browser.set.window.max()
        except Exception as e:
            logger.warning(f"设置窗口最大化失败: {str(e)}")
        logger.info(f"使用DrissionPage，User-Agent: {self.browser.user_agent}")

        self._navigate_to_home()

    def _navigate_to_home(self):
        """导航到首页"""
        self.browser.get(HOME_URL, retry=3, interval=2, timeout=15)
        # 简单等待页面加载
        time.sleep(5)

    def login(self):
        logger.info(f"账户 [{self.username}] 开始登录")
        return self._login_drission()

    def _login_drission(self):
        """使用DrissionPage登录"""
        try:
            self.browser.get(LOGIN_URL, retry=3, interval=2, timeout=15)

            # 等待页面加载
            time.sleep(5)

            time.sleep(2)

            # 填写用户名
            username_input = self.browser.ele('#login-account-name', timeout=10)
            if username_input:
                username_input.input(self.username)
                time.sleep(2)
            else:
                logger.error("未找到用户名输入框")
                return False

            # 填写密码
            password_input = self.browser.ele('#login-account-password', timeout=10)
            if password_input:
                password_input.input(self.password)
                time.sleep(2)
            else:
                logger.error("未找到密码输入框")
                return False

            # 点击登录按钮
            login_button = self.browser.ele('#login-button', timeout=10)
            if login_button:
                logger.info("找到登录按钮，准备点击...")
                login_button.click()
                logger.info("已点击登录按钮，等待登录完成...")
                # 简单等待，让用户手动处理人机验证
                time.sleep(30)
            else:
                logger.error("未找到登录按钮")
                return False

            # 检查登录是否成功
            user_ele = self.browser.ele("#current-user", timeout=15)
            if user_ele:
                logger.info(f"账户 [{self.username}] 登录成功")
                return True
            else:
                # 保存调试信息
                logger.error(f"账户 [{self.username}] 登录失败")
                self.browser.get_screenshot(path="debug_login_failed_drission.png", full_page=True)
                with open("debug_login_failed_drission.html", "w", encoding="utf-8") as f:
                    f.write(self.browser.html)
                logger.info("已保存登录失败的调试文件")
                return False

        except Exception as e:
            logger.error(f"DrissionPage登录过程出错: {str(e)}")
            return False



    def click_topic(self):
        # 参考原项目的选择器：self.page.ele("@id=list-area").eles(".:title")
        list_area = self.browser.ele("@id=list-area")
        if list_area:
            topic_list = list_area.eles(".:title")
        else:
            # 备用选择器
            topic_list = self.browser.eles("#list-area .title")

        logger.info(f"发现 {len(topic_list)} 个主题帖")

        if len(topic_list) == 0:
            logger.warning("未找到主题帖，保存页面用于调试...")
            self.browser.get_screenshot(path="debug_homepage.png", full_page=True)
            with open("debug_homepage.html", "w", encoding="utf-8") as f:
                f.write(self.browser.html)
            logger.info("已保存调试截图和HTML文件")
            return

        # 先收集所有链接，避免元素失效问题
        topic_links = []
        for topic in topic_list:
            href = topic.attr("href")
            if href:
                topic_links.append(href)

        # 恢复原来的选择策略：从前20个帖子中随机选择10个
        # 现在可以处理"很久以前"的对话框了
        available_count = min(20, len(topic_links))
        recent_links = topic_links[:available_count]
        selected_links = random.sample(recent_links, min(10, len(recent_links)))
        logger.info(f"从前 {available_count} 个帖子中随机选择 {len(selected_links)} 个进行浏览")

        for link in selected_links:
            self.click_one_topic(link)

    @retry_decorator()
    def click_one_topic(self, topic_url):
        # 在同一个标签页中浏览帖子，保持登录状态
        try:
            # Linux.Do的链接已经是完整URL，直接使用
            logger.info(f"访问帖子: {topic_url}")
            self.browser.get(topic_url)
            # 等待页面加载
            time.sleep(2)
            # 去掉点赞功能，只浏览帖子
            self.browse_post_drission(self.browser)
            # 浏览完成后等待一下
            time.sleep(1)
        except Exception as e:
            logger.error(f"浏览帖子失败: {str(e)}")



    def browse_post_drission(self, page):
        """DrissionPage版本的浏览帖子功能"""
        prev_url = None
        # 参考原项目：开始自动滚动，最多滚动10次
        for _ in range(10):
            # 随机滚动一段距离
            scroll_distance = random.randint(550, 650)
            logger.info(f"向下滚动 {scroll_distance} 像素...")
            page.run_js(f"window.scrollBy(0, {scroll_distance})")
            logger.info(f"已加载页面: {page.url}")

            if random.random() < 0.03:
                logger.success("随机退出浏览")
                break

            # 检查是否到达页面底部
            at_bottom = page.run_js("return window.scrollY + window.innerHeight >= document.body.scrollHeight")
            current_url = page.url
            if current_url != prev_url:
                prev_url = current_url
            elif at_bottom and prev_url == current_url:
                logger.success("已到达页面底部，退出浏览")
                break

            # 动态随机等待，参考原项目：2-4秒
            wait_time = random.uniform(2, 4)
            logger.info(f"等待 {wait_time:.2f} 秒...")
            time.sleep(wait_time)



    def run(self):
        if not self.login():
            logger.error("登录失败，程序终止")
            sys.exit(1)  # 使用非零退出码终止整个程序
        self.click_topic() # 浏览帖子
        self.print_connect_info()
        self.send_gotify_notification()





    def print_connect_info(self):
        logger.info("获取连接信息")
        self._print_connect_info_drission()

    def _print_connect_info_drission(self):
        """DrissionPage版本的连接信息获取"""
        try:
            self.browser.get("https://connect.linux.do/")
            time.sleep(5)  # 增加等待时间

            # 参考原项目的选择器：page.ele("tag:table").eles("tag:tr")
            table = self.browser.ele("tag:table")
            if table:
                rows = table.eles("tag:tr")
            else:
                # 备用选择器
                rows = self.browser.eles("table tr")

            info = []

            for row in rows:
                cells = row.eles("tag:td")
                if len(cells) >= 3:
                    project = cells[0].text.strip()
                    current = cells[1].text.strip()
                    requirement = cells[2].text.strip()
                    info.append([project, current, requirement])

            print("--------------Connect Info-----------------")
            print(tabulate(info, headers=["项目", "当前", "要求"], tablefmt="pretty"))

        except Exception as e:
            logger.error(f"DrissionPage获取连接信息失败: {str(e)}")



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
    # 检测运行环境
    is_github_actions = os.getenv('GITHUB_ACTIONS') == 'true'
    if is_github_actions:
        logger.info("检测到GitHub Actions环境")
        # 在GitHub Actions中测试Chrome是否可用
        try:
            import subprocess
            result = subprocess.run(['google-chrome', '--version'], capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                logger.info(f"Chrome版本: {result.stdout.strip()}")
            else:
                logger.warning("Chrome可能未正确安装")
        except Exception as e:
            logger.warning(f"无法检测Chrome版本: {e}")

    total_accounts = len(usernames)
    logger.info(f"共找到 {total_accounts} 个账户，开始执行任务...")

    for i, (username, password) in enumerate(zip(usernames, passwords), 1):
        logger.info(f"--- 开始处理第 {i}/{total_accounts} 个账户: {username} ---")
        l = None
        try:
            # 只使用DrissionPage，不使用Playwright避免人机验证
            logger.info("使用DrissionPage无头模式...")
            l = LinuxDoBrowser(username, password, headless=True)
            l.run()
            logger.info(f"--- 账户 {username} 处理完成 ---")
        except Exception as e:
            logger.error(f"处理账户 {username} 时发生严重错误: {e}")
            logger.exception("详细错误信息:") # 打印堆栈跟踪
        finally:
            # 确保浏览器资源被释放，即使出错
            try:
                if l:
                    l.browser.quit() # 关闭DrissionPage浏览器
            except Exception as close_err:
                logger.warning(f"关闭账户 {username} 的浏览器资源时出错: {close_err}")
            # 在账户之间添加短暂延时，可选
            if i < total_accounts:
                delay = random.uniform(30, 60)
                logger.info(f"等待 {delay:.2f} 秒后处理下一个账户...")
                time.sleep(delay)

    logger.info("所有账户处理完毕。")
