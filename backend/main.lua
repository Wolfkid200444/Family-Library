local millennium = require("millennium")
local logger = require("logger")

return {
    on_load = function()
        logger:info("Family Library loaded")
        millennium.ready()
    end,
    on_unload = function()
        logger:info("Family Library unloaded")
    end,
    patches = {
        {
            -- Patch only the desktop family-library status component. Capture
            -- variables so Steam's minifier can rename them between updates.
            find = [[const\{details:\w+,overview:\w+\}=\w+,\[\w+,\w+\]=\w+\.useState\(!1\).*?"#FamilyGroup_GameAvailable".*?\.SharedLibrary\),children:\[\(0,\w+\.PP\)\(\w+,\w+\),]],
            file = [[chunk~[0-9a-f]+\.js]],
            transforms = {
                {
                    match = [[(const\{details:(\w+),overview:\w+\}=\w+,\[\w+,\w+\]=\w+\.useState\(!1\).*?"#FamilyGroup_GameAvailable".*?\.SharedLibrary\),children:\[\(0,\w+\.PP\)\((\w+),\w+\),)]],
                    replace = [[\1\3==="#FamilyGroup_GameAvailable"&&#{{self}}?.ownerBadge?.render?.(\2.unAppID),]],
                },
            },
        },
    },
}
