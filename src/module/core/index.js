/*
* core: 核心方法
* 1.刷新
* 2.渲染GM DOM
* 3.重置tbody
* */
import { jTool, base, parseTpl, cache } from '../../common';
import menu from '../menu';
import adjust from '../adjust';
import ajaxPage from '../ajaxPage';
import config from '../config';
import checkbox from '../checkbox';
import order from '../order';
import remind from '../remind';
import sort from '../sort';
import filter from '../filter';
import scroll from '../scroll';
import wrapTpl from './wrap.tpl.html';
import theadTpl from './thead.tpl.html';
import thTpl from './th.tpl.html';

class Core {
    /**
     * 刷新表格 使用现有参数重新获取数据，对表格数据区域进行渲染
     * @param $table
     * @param callback
     * @private
     */
    refresh($table, callback) {
        const settings = cache.getSettings($table);

        const tableWrap = $table.closest('.table-wrap');

        // 更新刷新图标状态
        ajaxPage.updateRefreshIconState($table, true);

        base.showLoading(tableWrap, settings.loadingTemplate);

        let ajaxPromise = this.transformToPromise($table, settings);

        settings.ajax_beforeSend(ajaxPromise);
        ajaxPromise
        .then(response => {
            this.driveDomForSuccessAfter($table, settings, response, callback);
            settings.ajax_success(response);
            settings.ajax_complete(response);
            base.hideLoading(tableWrap);
            ajaxPage.updateRefreshIconState($table, false);
        })
        .catch(error => {
            settings.ajax_error(error);
            settings.ajax_complete(error);
            base.hideLoading(tableWrap);
            ajaxPage.updateRefreshIconState($table, false);
        });
    }

    /**
     * 将不同类型的ajax_data转换为promise
     * @param $table
     * @param settings
     * @returns promise
     */
    transformToPromise($table, settings) {
        const params = getParams();
        // 将 requestHandler 内修改的分页参数合并至 settings.pageData
        if (settings.supportAjaxPage) {
            jTool.each(settings.pageData, (key, value) => {
                settings.pageData[key] = params[key] || value;
            });
        }

        // 将 requestHandler 内修改的排序参数合并至 settings.sortData
        jTool.each(settings.sortData, (key, value) => {
            settings.sortData[key] = params[`${settings.sortKey}${key}`] || value;
        });
        cache.setSettings(settings);

        let ajaxData = typeof settings.ajax_data === 'function' ? settings.ajax_data(settings, params) : settings.ajax_data;

        // ajaxData === string url
        if (typeof ajaxData === 'string') {
            return getPromiseByUrl(params);
        }

        // ajaxData === Promise
        if (typeof ajaxData.then === 'function') {
            return ajaxData;
        }

        // 	ajaxData === 静态数据
        if (jTool.type(ajaxData) === 'object' || jTool.type(ajaxData) === 'array') {
            return new Promise(resolve => {
                resolve(ajaxData);
            });
        }

        // 获取参数信息
        function getParams() {
            let _params = jTool.extend(true, {}, settings.query);

            // 合并分页信息至请求参
            if (settings.supportAjaxPage) {
                _params[settings.currentPageKey] = settings.pageData[settings.currentPageKey];
                _params[settings.pageSizeKey] = settings.pageData[settings.pageSizeKey];
            }

            // 合并排序信息至请求参, 排序数据为空时则忽略
            if (!jTool.isEmptyObject(settings.sortData)) {
                // settings.mergeSort: 是否合并排序字段
                // false: {sort_createDate: 'DESC', sort_title: 'ASC'}
                // true: sort: {createDate: 'DESC'}
                if (settings.mergeSort) {
                    _params[settings.sortKey] = '';
                    jTool.each(settings.sortData, (key, value) => {
                        _params[settings.sortKey] = `${_params[settings.sortKey]}${_params[settings.sortKey] ? ',' : ''}${key}:${value}`;
                    });
                } else {
                    jTool.each(settings.sortData, (key, value) => {
                        // 增加sort_前缀,防止与搜索时的条件重叠
                        _params[`${settings.sortKey}${key}`] = value;
                    });
                }
            }

            // 请求前处理程序, 可以通过该方法增加 或 修改全部的请求参数
            // requestHandler方法内需返回修改后的参数
            _params = settings.requestHandler(base.cloneObject(_params));
            return _params;
        }

        // 获取Promise, 条件: ajax_data 为 url
        function getPromiseByUrl(Params) {
            // 当前为POST请求 且 Content-Type 未进行配置时, 默认使用 application/x-www-form-urlencoded
            // 说明|备注:
            // 1. Content-Type = application/x-www-form-urlencoded 的数据形式为 form data
            // 2. Content-Type = text/plain;charset=UTF-8 的数据形式为 request payload
            if (settings.ajax_type.toUpperCase() === 'POST' && !settings.ajax_headers['Content-Type']) {
                settings.ajax_headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            return new Promise((resolve, reject) => {
                jTool.ajax({
                    url: ajaxData,
                    type: settings.ajax_type,
                    data: Params,
                    headers: settings.ajax_headers,
                    xhrFields: settings.ajax_xhrFields,
                    cache: true,
                    success: response => {
                        resolve(response);
                    },
                    error: (XMLHttpRequest, textStatus, errorThrown) => {
                        reject(XMLHttpRequest, textStatus, errorThrown);
                    }
                });
            });
        }
    }

    /**
     * 清空当前表格数据
     * @param $table
     */
    cleanData($table) {
        const settings = cache.getSettings($table);
        this.insertEmptyTemplate($table, settings);
        cache.setTableData($table, []);

        // 渲染选择框
        if (settings.supportCheckbox) {
            checkbox.resetDOM($table, settings, []);
        }

        // 渲染分页
        if (settings.supportAjaxPage) {
            ajaxPage.resetPageData($table, settings, 0);
            menu.updateMenuPageStatus(settings.gridManagerName, settings);
        }
    }

    /**
     * 执行ajax成功后重新渲染DOM
     * @param $table
     * @param settings
     * @param response
     * @param callback
     */
    driveDomForSuccessAfter($table, settings, response, callback) {
        // 用于防止在填tbody时，实例已经被消毁的情况。
        if (!$table || $table.length === 0 || !$table.hasClass('GridManager-ready')) {
            return;
        }

        if (!response) {
            base.outLog('请求数据失败！请查看配置参数[ajax_data]是否配置正确，并查看通过该地址返回的数据格式是否正确', 'error');
            return;
        }

        let parseRes = typeof (response) === 'string' ? JSON.parse(response) : response;

        // 执行请求后执行程序, 通过该程序可以修改返回值格式
        parseRes = settings.responseHandler(base.cloneObject(parseRes));

        let _data = parseRes[settings.dataKey];
        let totals = parseRes[settings.totalsKey];

        // 数据校验: 数据异常
        if (!_data || !Array.isArray(_data)) {
            base.outLog(`请求数据失败！response中的${settings.dataKey}必须为数组类型，可通过配置项[dataKey]修改字段名。`, 'error');
            return;
        }

        // 数据校验: 未使用无总条数模式 且 总条数无效时直接跳出
        if (settings.supportAjaxPage && !settings.useNoTotalsMode && isNaN(parseInt(totals, 10))) {
            base.outLog('分页错误，请确认返回数据中是否存在totals字段(或配置项totalsKey所指定的字段)。', 'error');
            return;
        }

        // 数据为空时
        if (_data.length === 0) {
            this.insertEmptyTemplate($table, settings);
            parseRes[settings.totalsKey] = 0;
        } else {
            this.renderTableBody($table, settings, _data);
        }

        // 渲染选择框
        if (settings.supportCheckbox) {
            checkbox.resetDOM($table, settings, _data, settings.useRadio);
        }

        // 渲染分页
        if (settings.supportAjaxPage) {
            ajaxPage.resetPageData($table, settings, parseRes[settings.totalsKey], _data.length);
            menu.updateMenuPageStatus(settings.gridManagerName, settings);
        }

        typeof callback === 'function' ? callback(parseRes) : '';
    };

    /**
     * 插入空数据模板
     * @param $table
     * @param settings
     * @param isInit: 是否为初始化时调用
     */
    insertEmptyTemplate($table, settings, isInit) {
        // 当前为第一次加载 且 已经执行过setQuery 时，不再插入空数据模板
        // 用于解决容器为不可见时，触发了setQuery的情况
        if (isInit && cache.getTableData($table).length !== 0) {
            return;
        }

        let visibleNum = base.getVisibleTh($table).length;
        const $tbody = jTool('tbody', $table);
        const $tableDiv = $table.closest('.table-div');
        $tbody.html(base.getEmptyHtml(visibleNum, settings.emptyTemplate));
        const emptyDOM = $tbody.get(0).querySelector('tr[emptyTemplate]');
        emptyDOM.style.height = $tableDiv.height() + 'px';
        base.compileFramework(settings, {el: emptyDOM});
    }

    /**
     * 重新组装table body
     * @param $table
     * @param settings
     * @param data
     */
    renderTableBody($table, settings, data) {
        // td模板
        let	tdTemplate = null;

        // add order
        if (settings.supportAutoOrder) {
            let _pageData = settings.pageData;
            let	_orderBaseNumber = 1;

            // 验证是否存在分页数据
            if (_pageData && _pageData[settings.pageSizeKey] && _pageData[settings.currentPageKey]) {
                _orderBaseNumber = _pageData[settings.pageSizeKey] * (_pageData[settings.currentPageKey] - 1) + 1;
            }
            data = data.map((item, index) => {
                item[order.key] = _orderBaseNumber + index;
                return item;
            });
        }

        // add checkbox
        if (settings.supportCheckbox) {
            const checkedData = cache.getCheckedData($table);
            data = data.map(rowData => {
                let checked = checkedData.some(item => {
                    let cloneRow = base.getDataForColumnMap(settings.columnMap, item);
                    let cloneItem = base.getDataForColumnMap(settings.columnMap, rowData);
                    return base.equal(cloneRow, cloneItem);
                });
                rowData[checkbox.key] = checked || Boolean(rowData[checkbox.key]);
                return rowData;
            });
            cache.setCheckedData($table, data);
        }

        // 存储表格数据
        cache.setTableData($table, data);

        // tbody dom
        const _tbody = jTool('tbody', $table).get(0);

        // 清空 tbody
        _tbody.innerHTML = '';

        // 组装 tbody
        const compileList = []; // 需要通过框架解析td数据
        try {
            jTool.each(data, (index, row) => {
                const trNode = document.createElement('tr');
                trNode.setAttribute('cache-key', index);

                // 插入通栏: top-full-column
                if (typeof settings.topFullColumn.template !== 'undefined') {
                    // 通栏tr
                    const topTrNode = document.createElement('tr');
                    topTrNode.setAttribute('top-full-column', 'true');

                    // 通栏用于向上的间隔的tr
                    const intervalTrNode = document.createElement('tr');
                    intervalTrNode.setAttribute('top-full-column-interval', 'true');
                    intervalTrNode.innerHTML = `<td colspan="${settings.columnData.length}"><div></div></td>`;
                    _tbody.appendChild(intervalTrNode);

                    // 为非通栏tr的添加标识
                    trNode.setAttribute('top-full-column', 'false');

                    let _template = settings.topFullColumn.template;
                    _template = typeof _template === 'function' ? _template(row) : _template;

                    topTrNode.innerHTML = `<td colspan="${settings.columnData.length}"><div class="full-column-td">${_template}</div></td>`;
                    compileList.push({el: topTrNode, row: row, index: index});
                    _tbody.appendChild(topTrNode);
                }

                // 与当前位置信息匹配的td列表
                const tdList = [];
                jTool.each(settings.columnMap, (key, col) => {
                    tdTemplate = col.template;
                    // td 模板
                    tdTemplate = typeof tdTemplate === 'function' ? tdTemplate(row[col.key], row, index) : (typeof tdTemplate === 'string' ? tdTemplate : row[col.key]);

                    // 插件自带列(序号,全选) 的 templateHTML会包含, 所以需要特殊处理一下
                    let tdNode = null;
                    if (col.isAutoCreate) {
                        tdNode = jTool(tdTemplate).get(0);
                    } else {
                        tdNode = jTool('<td gm-create="false"></td>').get(0);
                        jTool.type(tdTemplate) === 'element' ? tdNode.appendChild(tdTemplate) : tdNode.innerHTML = (typeof tdTemplate === 'undefined' ? '' : tdTemplate);
                    }

                    // td 文本对齐方向
                    col.align && tdNode.setAttribute('align', col.align);

                    tdList[col.index] = tdNode;
                });

                tdList.forEach(td => {
                    trNode.appendChild(td);
                });

                compileList.push({el: trNode, row: row, index: index});

                _tbody.appendChild(trNode);
            });
        } catch (e) {
            base.outLog(e, 'error');
        }
        // 为新生成的tbody 的内容绑定 gm-事件
        this.bindEvent($table);

        this.initVisible($table);

        // 解析框架
        base.compileFramework(settings, compileList);
    }

    /**
     * 为新增的单元格绑定事件
     * @param $table
     */
    bindEvent($table) {
        jTool('[gm-click]', $table).unbind('click');
        jTool('[gm-click]', $table).bind('click', function () {
            const row = cache.getRowData($table, this.parentNode.parentNode);
            const scope = cache.getScope($table) || window;
            const fun = scope[this.getAttribute('gm-click')];
            typeof fun === 'function' && fun.call(scope, row);
        });
    }

    /**
     * 生成table wrap 模板
     * @param params
     * @returns {parseData}
     */
    @parseTpl(wrapTpl)
    createWrapTpl(params) {
        const settings = params.settings;
        const { skinClassName, isIconFollowText, disableBorder, supportConfig, supportAjaxPage, configInfo, ajaxPageTemplate } = settings;
        const wrapClassList = [];
        // 根据参数增加皮肤标识
        if (skinClassName && typeof skinClassName === 'string' && skinClassName.trim()) {
            wrapClassList.push(skinClassName);
        }

        // 根据参数，增加表头的icon图标是否跟随文本class
        if (isIconFollowText) {
            wrapClassList.push('icon-follow-text');
        }

        // 根据参数增加禁用禁用边框线标识
        if (disableBorder) {
            wrapClassList.push('disable-border');
        }

        return {
            classNames: wrapClassList.join(' '),
            configTpl: supportConfig ? config.createHtml({configInfo}) : '',
            ajaxPageTpl: supportAjaxPage ? ajaxPage.createHtml({settings, tpl: ajaxPageTemplate}) : ''
        };
    }

    /**
     * 生成table head 模板
     * @param params
     * @returns {parseData}
     */
    @parseTpl(theadTpl)
    createTheadTpl(params) {
        const settings = params.settings;

        // 将 columnMap 转换为 数组
        // 转换的原因是为了处理用户记忆
        const columnList = [];
        if (settings.disableCache) {
            jTool.each(settings.columnMap, (key, col) => {
                columnList.push(col);
            });
        } else {
            jTool.each(settings.columnMap, (key, col) => {
                columnList[col.index] = col;
            });
        }

        // 将表头提醒启用状态重置
        remind.enable = false;

        // 将排序启用状态重置
        sort.enable = false;

        // 将筛选条件重置
        filter.enable = false;

        let thListTpl = '';
        // columnList 生成thead
        jTool.each(columnList, (index, col) => {
            thListTpl += this.createThTpl({settings, col});
        });

        return {
            tableHeadKey: base.tableHeadKey,
            thListTpl
        };
    }

    /**
     * 生成table th 模板
     * @param params
     * @returns {parseData}
     */
    @parseTpl(thTpl)
    createThTpl(params) {
        const { settings, col } = params;

        // 表头提醒
        let remindAttr = '';
        if (typeof (col.remind) === 'string' && col.remind !== '') {
            remindAttr = `remind=${col.remind}`;
            remind.enable = true;
        }

        // 排序
        let sortingAttr = '';
        if (typeof (col.sorting) === 'string') {
            sort.enable = true;
            if (col.sorting === settings.sortDownText) {
                // th.setAttribute('sorting', settings.sortDownText);
                sortingAttr = `sorting="${settings.sortDownText}"`;
                settings.sortData[col.key] = settings.sortDownText;
            } else if (col.sorting === settings.sortUpText) {
                // th.setAttribute('sorting', settings.sortUpText);
                sortingAttr = `sorting="${settings.sortUpText}"`;
                settings.sortData[col.key] = settings.sortUpText;
            } else {
                sortingAttr = `sorting=""`;
            }
        }

        // 过滤
        let filterAttr = '';
        if (jTool.type(col.filter) === 'object') {
            filter.enable = true;
            filterAttr = `filter=""`;
            if (typeof (col.filter.selected) === 'undefined') {
                col.filter.selected = settings.query[col.key];
            } else {
                settings.query[col.key] = col.filter.selected;
            }
        }

        // 文本对齐
        const alignAttr = col.align ? `align="col.align"` : '';

        // th可视状态值
        let thVisible = base.getVisibleForColumn(col);

        let gmCreateAttr = '';
        let thName = '';
        let thText = '';
        let checkboxAttr = '';
        let orderAttr = '';
        switch (col.key) {
            // 插件自动生成序号列
            case order.key:
                gmCreateAttr = `gm-create="true"`;
                thName = order.key;
                orderAttr = `gm-order="true"`;
                thText = order.getThContent(settings);
                break;
            // 插件自动生成选择列
            case checkbox.key:
                gmCreateAttr = `gm-create="true"`;
                thName = checkbox.key;
                checkboxAttr = `gm-checkbox="true"`;
                thText = checkbox.getThContent(settings.useRadio);
                break;
            // 普通列
            default:
                gmCreateAttr = `gm-create="false"`;
                thName = col.key;
                thText = col.text;
                break;
        }

        // 嵌入拖拽事件标识, 以下情况除外
        // 1.插件自动生成列
        // 2.禁止使用个性配置功能的列
        let dragClassName = '';
        if (settings.supportDrag && !col.isAutoCreate && !col.disableCustomize) {
            dragClassName = 'drag-action';
        }

        return {
            thName,
            thText,
            checkboxAttr,
            orderAttr,
            sortingAttr,
            alignAttr,
            filterAttr,
            remindAttr,
            dragClassName,
            thVisible,
            gmCreateAttr,
            thStyle: `style="width:${col.width || 'auto'}"`
        };
    }

    /**
     * 渲染HTML，根据配置嵌入所需的事件源DOM
     * @param $table
     * @param settings
     * @returns {Promise<any>}
     */
    async createDOM($table, settings) {
        // add wrap div
        $table.wrap(this.createWrapTpl({ settings }));

        // 计算布局
        base.calcLayout($table, settings.width, settings.height, settings.supportAjaxPage);

        // append thead
        $table.append(this.createTheadTpl({settings}));

        // append tbody
        $table.append(document.createElement('tbody'));

        cache.setSettings(settings);

        // 单个table下的thead
        const $thead = base.getHead($table);

        // 单个table下的TH
        const $thList = jTool('th', $thead);

        // 单个table所在的DIV容器
        const $tableWarp = $table.closest('.table-wrap');

        // 等待容器可用
        await this.waitContainerAvailable(settings.gridManagerName, $tableWarp.get(0));

        // 重绘thead
        this.redrawThead($table, $tableWarp, $thList, settings);

        // 初始化fake thead
        scroll.init($table);

        // 解析框架: thead区域
        await base.compileFramework(settings, [{el: $thead.get(0).querySelector('tr')}]);

        // 删除渲染中标识、增加渲染完成标识
        $table.removeClass('GridManager-loading');
        $table.addClass('GridManager-ready');
    }

    /**
     * 等待容器可用
     * @param gridManagerName
     * @param tableWarp
     */
    waitContainerAvailable(gridManagerName, tableWarp) {
        return new Promise(resolve => {
            base.SIV_waitContainerAvailable[gridManagerName] = setInterval(() => {
                let tableWarpWidth = window.getComputedStyle(tableWarp).width;
                if (tableWarpWidth !== '100%') {
                    clearInterval(base.SIV_waitContainerAvailable[gridManagerName]);
                    base.SIV_waitContainerAvailable[gridManagerName] = null;
                    resolve();
                }
            }, 50);
        });
    }

    /**
     * 重绘thead
     * @param $table
     * @param $tableWarp
     * @param $thList
     * @param settings
     */
    redrawThead($table, $tableWarp, $thList, settings) {
        // 由于部分操作需要在th已经存在于dom的情况下执行, 所以存在以下循环
        // 单个TH下的上层DIV
        jTool.each($thList, (index, item) => {
            let onlyTH = jTool(item);
            const onlyThWarp = jTool('.th-wrap', onlyTH);
            const thName = onlyTH.attr('th-name');
            const onlyThText = onlyTH.text();
            const column = settings.columnMap[thName];

            // 是否为GM自动添加的列
            const isAutoCol = column.isAutoCreate;

            // 嵌入表头提醒事件源
            // 插件自动生成的序号与选择列不做事件绑定
            if (!isAutoCol && jTool.type(column.remind) === 'string') {
                onlyThWarp.append(jTool(remind.createHtml(onlyThText, column.remind)));
            }

            // 嵌入排序事件源
            // 插件自动生成的序号列与选择列不做事件绑定
            // 排序类型
            if (!isAutoCol && jTool.type(column.sorting) === 'string') {
                const sortingDom = jTool(sort.createHtml());

                // 依据 column.sorting 进行初始显示
                switch (column.sorting) {
                    case settings.sortUpText:
                        sortingDom.addClass('sorting-up');
                        break;
                    case settings.sortDownText:
                        sortingDom.addClass('sorting-down');
                        break;
                    default :
                        break;
                }
                onlyThWarp.append(sortingDom);
            }

            // 嵌入表头的筛选事件源
            // 插件自动生成的序号列与选择列不做事件绑定
            if (!isAutoCol && column.filter && jTool.type(column.filter) === 'object') {
                const filterDom = jTool(filter.createHtml({settings, columnFilter: column.filter, $tableWarp}));
                onlyThWarp.append(filterDom);
            }

            // 嵌入宽度调整事件源,以下情况除外
            // 1.插件自动生成的选择列不做事件绑定
            // 2.禁止使用个性配置功能的列
            if (settings.supportAdjust && !isAutoCol && !column.disableCustomize) {
                const adjustDOM = jTool(adjust.html);

                // 最后一列不支持调整宽度
                if (index === $thList.length - 1) {
                    adjustDOM.hide();
                }

                onlyThWarp.append(adjustDOM);
            }
        });

        // 更新列宽
        base.updateThWidth($table, settings, true);
    }

    /**
     * 根据配置项初始化列显示|隐藏 (th 和 td)
     * @param $table
     */
    initVisible($table) {
        // tbody下的tr
        const _trList = jTool('tbody tr', $table);
        let	_th = null;
        let	_td = null;
        let _visible = 'visible';
        const settings = cache.getSettings($table);
        jTool.each(settings.columnMap, (index, col) => {
            _th = jTool(`th[th-name="${col.key}"]`, $table);
            _visible = base.getVisibleForColumn(col);
            _th.attr('th-visible', _visible);
            jTool.each(_trList, (i2, v2) => {
                _td = jTool('td', v2).eq(_th.index());
                _td.attr('td-visible', _visible);
            });
        });
    }
}
export default new Core();