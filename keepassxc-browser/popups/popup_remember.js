'use strict';

const DEFAULT_BROWSER_GROUP = 'KeePassXC-Browser Passwords';

var _tab;

function _initialize(tab) {
    _tab = tab;

    // No credentials set or credentials already cleared
    if (!_tab.credentials.username && !_tab.credentials.password) {
        _close();
        return;
    }

    // No existing credentials to update --> disable Update button
    if (_tab.credentials.list.length === 0) {
        $('#btn-update').attr('disabled', true).removeClass('btn-warning');
    }

    // No username available. This might be because of trigger from context menu --> disable New button
    if (!_tab.credentials.username && _tab.credentials.password) {
        $('#btn-new').attr('disabled', true).removeClass('btn-success');
    }

    let url = _tab.credentials.url;
    url = (url.length > 50) ? url.substring(0, 50) + '...' : url;
    $('.information-url:first').text(url);
    $('.information-username:first').text(_tab.credentials.username);

    $('#btn-new').click(function(e) {
        e.preventDefault();
        $('.credentials').hide();
        $('ul#list').empty();

        // Get group listing from KeePassXC
        browser.runtime.sendMessage({
            action: 'get_database_groups'
        }).then((result) => {
            // Only the Root group and no KeePassXC-Browser passwords -> save to default
            if (result.groups === undefined || (result.groups.length > 0 && result.groups[0].children.length === 0)) {
                browser.runtime.sendMessage({
                    action: 'add_credentials',
                    args: [ _tab.credentials.username, _tab.credentials.password, _tab.credentials.url ]
                }).then(_verifyResult);
            }

            const addChildren = function(group, parentElement, depth) {
                depth += 1;
                const padding = depth * 20;

                for (const child of group.children) {
                    const a = createLink(child.name, child.uuid, child.children.length > 0);
                    a.attr('id', 'child');
                    a.css('cssText', 'padding-left: ' + String(padding) + 'px !important;');

                    if (parentElement.attr('id') === 'root') {
                        a.attr('id', 'root-child');
                    }

                    $('ul#list').append(a);
                    addChildren(child, a, depth);
                }
            };

            const createLink = function(group, groupUuid, hasChildren) {
                const a = $('<a>')
                    .attr('href', '#')
                    .attr('class', 'list-group-item')
                    .text(group)
                    .click(function(ev) {
                        ev.preventDefault();
                        browser.runtime.sendMessage({
                            action: 'add_credentials',
                            args: [ _tab.credentials.username, _tab.credentials.password, _tab.credentials.url, group, groupUuid ]
                        }).then(_verifyResult);
                    });

                if (hasChildren) {
                    a.text('\u25BE ' + group);
                }
                return a;
            };

            let depth = 0;
            for (const g of result.groups) {
                const a = createLink(g.name, g.uuid, g.children.length > 0);
                a.attr('id', 'root');

                $('ul#list').append(a);
                addChildren(g, a, depth);
            }

            $('.groups').show();
        });
    });

    $('#btn-update').click(function(e) {
        e.preventDefault();
        $('.groups').hide();
        $('ul#list').empty();

        //  Only one entry which could be updated
        if (_tab.credentials.list.length === 1) {
            // Use the current username if it's empty
            if (!_tab.credentials.username) {
                _tab.credentials.username = _tab.credentials.list[0].login;
            }

            browser.runtime.sendMessage({
                action: 'update_credentials',
                args: [ _tab.credentials.list[0].uuid, _tab.credentials.username, _tab.credentials.password, _tab.credentials.url ]
            }).then(_verifyResult);
        } else {
            $('.credentials:first .username-new:first strong:first').text(_tab.credentials.username);
            $('.credentials:first .username-exists:first strong:first').text(_tab.credentials.username);

            if (_tab.credentials.usernameExists) {
                $('.credentials:first .username-new:first').hide();
                $('.credentials:first .username-exists:first').show();
            } else {
                $('.credentials:first .username-new:first').show();
                $('.credentials:first .username-exists:first').hide();
            }

            for (let i = 0; i < _tab.credentials.list.length; i++) {
                const $a = $('<a>')
                    .attr('href', '#')
                    .attr('class', 'list-group-item')
                    .text(_tab.credentials.list[i].login + ' (' + _tab.credentials.list[i].name + ')')
                    .data('entryId', i)
                    .click(function(e) {
                        e.preventDefault();
                        const entryId = $(this).data('entryId');

                        // Use the current username if it's empty
                        if (!_tab.credentials.username) {
                            _tab.credentials.username = _tab.credentials.list[entryId].login;
                        }

                        // Check if the password has changed for the updated credentials
                        browser.runtime.sendMessage({
                            action: 'retrieve_credentials',
                            args: [ url, '', false, true ]
                        }).then((credentials) => {
                            if (!credentials || credentials.length !== _tab.credentials.list.length) {
                                _verifyResult('error');
                                return;
                            }

                            // Show a notification if the user tries to update credentials using the old password
                            if (credentials[entryId].password === _tab.credentials.password) {
                                showNotification('Error: Credentials not updated. The password has not been changed.');
                                _close();
                                return;
                            }

                            browser.runtime.sendMessage({
                                action: 'update_credentials',
                                args: [_tab.credentials.list[entryId].uuid, _tab.credentials.username, _tab.credentials.password, _tab.credentials.url]
                            }).then(_verifyResult);
                        });
                    });

                if (_tab.credentials.usernameExists && _tab.credentials.username === _tab.credentials.list[i].login) {
                    $a.css('font-weight', 'bold');
                }

                $('ul#list').append($a);
            }

            $('.credentials').show();
        }
    });

    $('#btn-dismiss').click(function(e) {
        e.preventDefault();
        _close();
    });

    $('#btn-ignore').click(function(e) {
        browser.windows.getCurrent().then((win) => {
            browser.tabs.query({ 'active': true, 'currentWindow': true }).then((tabs) => {
                const currentTab = tabs[0];
                browser.runtime.getBackgroundPage().then((global) => {
                    browser.tabs.sendMessage(currentTab.id, {
                        action: 'ignore-site',
                        args: [ _tab.credentials.url ]
                    });
                    _close();
                });
            });
        });
    });
}

function _connectedDatabase(db) {
    if (db.count > 1 && db.identifier) {
        $('.connected-database:first em:first').text(db.identifier);
        $('.connected-database:first').show();
    } else {
        $('.connected-database:first').hide();
    }
}

function _verifyResult(code) {
    if (code === 'error') {
        showNotification('Error: Credentials cannot be saved or updated.');
    }
    _close();
}

function _close() {
    browser.runtime.sendMessage({
        action: 'remove_credentials_from_tab_information'
    });

    browser.runtime.sendMessage({
        action: 'pop_stack'
    });

    close();
}

$(function() {
    browser.runtime.sendMessage({
        action: 'stack_add',
        args: [ 'icon_remember_red_background_19x19.png', 'popup_remember.html', 10, true, 0 ]
    });

    browser.runtime.sendMessage({
        action: 'get_tab_information'
    }).then(_initialize);

    browser.runtime.sendMessage({
        action: 'get_connected_database'
    }).then(_connectedDatabase);
});
