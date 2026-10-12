import { addBlobUrl, createBlobUrl } from '@project/common/blob-url';
import type { FileWithId } from '@project/common/file-selector/file-selector';

/** Remote media has a metadata-only File. Never create an empty blob from it. */
export function mediaFileUrl(media: FileWithId): string {
    if (media.remoteUrl) {
        addBlobUrl(media.remoteUrl);
        return media.remoteUrl;
    }
    return createBlobUrl(media.file);
}
